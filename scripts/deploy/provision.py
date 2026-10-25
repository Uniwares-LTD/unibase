"""Additive provisioning on the existing Linux host. Preview never mutates resources."""
import argparse
import hashlib
import json
import os
import secrets as random_secrets
import socket
import subprocess
import sys
import tempfile
from pathlib import Path
from ipaddress import ip_network
from environment import ROOT, load
from providers import API, Resources, ProviderError


def private_write(path, value):
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("Unsafe private file path")
    if path.with_name(path.name + ".pending").is_symlink():
        raise ValueError("Unsafe private temporary file")
    fd, name = tempfile.mkstemp(prefix=path.name + ".pending.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w") as file:
            file.write(value)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)


def read_runtime(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if not line or line.startswith("#"):
                continue
            key, value = line.split("=", 1)
            if key in values:
                raise ValueError("Duplicate private runtime setting")
            values[key] = value
    return values


def host_config(root):
    staging, production = (load(target, root, False) for target in ("staging", "production"))
    config = {"imageRepository": staging["deployment"]["imageRepository"] or production["deployment"]["imageRepository"]}
    for item in (staging, production):
        config[item["environment"]] = {
            "origin": item["runtime"]["APP_ORIGIN"], "firebaseProject": item["google"]["projectId"],
            "mongoDatabase": item["runtime"]["MONGODB_DATABASE"], "mongoUser": item["atlas"]["mongoUser"],
            **{key: item["deployment"][key] for key in ("port", "ingressSubnet", "redisImage", "nginxImage")}}
    return config


class Host:
    def __init__(self, config, slug, directory=None):
        self.config, self.slug = config, slug
        self.root = directory or Path("/etc") / slug
        self.directory = self.root / config["environment"]
        self.state_file = self.directory / "provision-state.json"
        self.key_file = self.directory / "firebase.json"

    def identity(self):
        return {"slug": self.slug, "environment": self.config["environment"],
                "googleProject": self.config["google"]["projectId"],
                "atlasProject": self.config["atlas"]["projectId"],
                "atlasCluster": self.config["atlas"]["clusterName"],
                "mongoUser": self.config["atlas"]["mongoUser"],
                "mongoDatabase": self.config["runtime"]["MONGODB_DATABASE"]}

    def state(self):
        if not self.state_file.exists():
            return None
        state = json.loads(self.state_file.read_text())
        if state.get("identity") != self.identity():
            raise ValueError("Provisioned resource identity changed; explicit migration required")
        return state

    def prepare(self):
        for directory in (self.root, self.directory, self.directory / "docker"):
            if directory.is_symlink():
                raise ValueError("Unsafe configuration directory")
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            directory.chmod(0o700)
            if hasattr(os, "chown") and os.geteuid() == 0:
                os.chown(directory, 0, 0)

    def save_state(self, state):
        private_write(self.state_file, json.dumps(state) + "\n")

    def preflight(self):
        for args in (["docker", "info"], ["docker", "compose", "version", "--short"]):
            result = subprocess.run(args, capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise ValueError("VPS Docker prerequisite failed")
            if args[-1] == "--short":
                version = tuple(int(part) for part in result.stdout.strip().lstrip("v").split(".")[:2])
                if version < (2, 30):
                    raise ValueError("Docker Compose 2.30 or newer is required")
        # A listener is allowed only when a retained release proves this app owns it.
        retained = Path("/opt") / self.slug / self.config["environment"] / "current/compose.env"
        owner = retained.exists() and read_runtime(retained).get("APP_PORT") == str(self.config["deployment"]["port"])
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", self.config["deployment"]["port"]))
            except OSError:
                if not owner:
                    raise ValueError("Configured loopback port is already allocated") from None
        networks = subprocess.run(["docker", "network", "ls", "-q"], capture_output=True, text=True, timeout=30, check=True)
        if networks.stdout.split():
            inspected = subprocess.run(["docker", "network", "inspect", *networks.stdout.split()], capture_output=True, text=True, timeout=30, check=True)
            desired = ip_network(self.config["deployment"]["ingressSubnet"])
            for network in json.loads(inspected.stdout):
                if (network.get("Labels") or {}).get("com.docker.compose.project") == self.slug + "-" + self.config["environment"]:
                    continue
                for entry in (network.get("IPAM") or {}).get("Config") or []:
                    if entry.get("Subnet") and ip_network(entry["Subnet"]).version == desired.version and ip_network(entry["Subnet"]).overlaps(desired):
                        raise ValueError("Configured Docker subnet is already allocated")

    def registry_preflight(self, credentials):
        with tempfile.TemporaryDirectory(prefix=self.slug + "-ghcr-preflight-") as directory:
            result = subprocess.run(["docker", "--config", directory, "login", "ghcr.io", "-u", self.config["ghcr"]["pullUser"], "--password-stdin"],
                                    input=credentials["GHCR_PULL_TOKEN"].encode(), capture_output=True, timeout=60)
            if result.returncode:
                raise ValueError("GHCR pull credential authentication failed before provisioning")

    def indexes(self, checkout, uid=None):
        # Administration tooling stays out of the production image. Only this
        # disposable container downloads npm tools; no provider admin token enters it.
        args = ["docker", "run", "--rm", "--memory", "1g", "--cpus", "1", "--network", "host", "--env-file", str(self.directory / "runtime.env"),
                "-e", "GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase.json",
                "-v", str(checkout) + ":/source:ro", "-v", str(self.key_file) + ":/run/secrets/firebase.json:ro",
                self.config["deployment"]["adminImage"], "sh", "-eu", "-c",
                "cp -a /source /tmp/admin; cd /tmp/admin; npm ci --ignore-scripts --no-audit --no-fund >/tmp/install.log 2>&1; "
                "npm run db:indexes >/tmp/admin.log 2>&1; " +
                ("npm run admin:bootstrap -- \"$1\" >>/tmp/admin.log 2>&1" if uid else "true"), "admin"]
        if uid:
            args.append(uid)
        if subprocess.run(args, capture_output=True, timeout=900).returncode:
            raise ValueError("Database administration failed; private details suppressed")


def provision(config, host, resources, apply, credentials, checkout, uid=None):
    state = host.state()
    if host.key_file.exists():
        key = json.loads(host.key_file.read_text())
        email = resources.account + "@" + resources.project + ".iam.gserviceaccount.com"
        if key.get("project_id") != resources.project or key.get("client_email") != email:
            raise ValueError("Saved Firebase credential ownership conflict before provisioning")
    user = resources.preflight()
    host.preflight()
    host.registry_preflight(credentials)
    if user and state is None:
        raise ValueError("Atlas user exists without saved credentials; operator recovery required")
    if not apply:
        print("Preview: configure Firebase, scoped Atlas user/network/indexes, private host files and GHCR pull access")
        print("Preview: shared routes are managed only by the owner workflow; no release will start")
        return
    host.prepare()
    if state is None:
        state = {"identity": host.identity(), "databasePassword": random_secrets.token_urlsafe(32)}
        host.save_state(state)  # Persist before creating the Atlas user: reruns reuse it.
    redis_file = host.directory / "redis-password"
    if not redis_file.exists():
        private_write(redis_file, random_secrets.token_urlsafe(32))
    saved_key = json.loads(host.key_file.read_text()) if host.key_file.exists() else None
    public, pending = resources.firebase(lambda value: private_write(host.key_file, json.dumps(value) + "\n"),
                                         saved_key, credentials.get("GOOGLE_OAUTH_CLIENT_SECRET"))
    uri = resources.database(state["databasePassword"], user)
    runtime = read_runtime(host.directory / "runtime.env")
    runtime.update({key: value for key, value in config["runtime"].items() if value is not None})
    runtime.update(public)
    runtime.update(MONGODB_URI=uri, REDIS_URL="redis://default:" + redis_file.read_text().strip() + "@redis:6379")
    catalog = json.loads((checkout / "scripts/deploy/environment-catalog.json").read_text())
    import re
    for key, value in runtime.items():
        if key not in catalog["runtime"] and not any(re.fullmatch(pattern, key) for pattern in catalog["credentialPatterns"]):
            raise ValueError("Unknown private runtime setting")
        if not isinstance(value, str) or any(char in value for char in "\n\r\0"):
            raise ValueError("Invalid private runtime value")
    private_write(host.directory / "runtime.env", "".join(f"{key}={value}\n" for key, value in sorted(runtime.items())))
    private_write(host.root / "config.json", json.dumps(host_config(checkout)) + "\n")
    from config import validate
    validate(host.root, config["environment"])
    login = subprocess.run(["docker", "--config", str(host.directory / "docker"), "login", "ghcr.io", "-u", config["ghcr"]["pullUser"], "--password-stdin"],
                           input=credentials["GHCR_PULL_TOKEN"].encode(), capture_output=True, timeout=60)
    if login.returncode:
        raise ValueError("GHCR scoped pull authentication failed")
    host.indexes(checkout, uid)
    state["configured"] = True
    state["pending"] = pending
    host.save_state(state)
    for message in pending:
        print("Pending: " + message)
    print("Provisioned private runtime and indexes; application release remains separate")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=["staging", "production"])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--credentials", type=Path)
    parser.add_argument("--admin-uid")
    parser.add_argument("--admin-uid-file", type=Path)
    args = parser.parse_args()
    if args.admin_uid_file:
        if args.admin_uid:
            raise ValueError("Supply one admin UID source")
        args.admin_uid = json.loads(args.admin_uid_file.read_text()) or None
    config = load(args.environment)
    if not args.credentials:
        print("Configuration valid; use the Provision environment workflow for provider/host preflight")
        return
    if os.geteuid() != 0:
        raise ValueError("Host provisioning requires the configured privileged operator")
    credentials = json.loads(args.credentials.read_text())
    for key in ("GOOGLE_ACCESS_TOKEN", "ATLAS_CLIENT_ID", "ATLAS_CLIENT_SECRET", "GHCR_PULL_TOKEN"):
        if not credentials.get(key):
            raise ValueError("Missing secret: " + key)
    slug = json.loads((ROOT / "project.config.json").read_text())["slug"]
    if not __import__("re").fullmatch(r"[a-z][a-z0-9-]{2,39}", slug):
        raise ValueError("Invalid project identity")
    if args.admin_uid and (len(args.admin_uid) > 128 or any(c in args.admin_uid for c in "\r\n\0")):
        raise ValueError("Invalid admin UID")
    host = Host(config, slug)
    resources = Resources(API(credentials), config, slug)
    # Existing app lock also serializes provisioning with releases. Preview uses
    # no persistent app directories and cannot start provider mutations.
    if args.apply:
        import fcntl
        import time
        state_dir = Path("/var/lib") / slug
        state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        from contextlib import ExitStack
        shared_lock = Path("/var/lock") / ("firebase-provision-" + hashlib.sha256(resources.project.encode()).hexdigest()[:24] + ".lock")
        with ExitStack() as stack:
            for path in (state_dir / "operation.lock", shared_lock):
                lock = stack.enter_context(open(path, "a"))
                deadline = time.monotonic() + 300
                while True:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise ValueError("Another provisioning/release operation owns the host lock") from None
                        time.sleep(1)
            provision(config, host, resources, True, credentials, ROOT, args.admin_uid)
            for directory in (Path("/opt") / slug, Path("/opt") / slug / args.environment,
                              Path("/opt") / slug / args.environment / "releases"):
                if directory.is_symlink():
                    raise ValueError("Unsafe release directory")
                directory.mkdir(mode=0o700, exist_ok=True)
                directory.chmod(0o700)
    else:
        provision(config, host, resources, False, credentials, ROOT, args.admin_uid)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, (ValueError, ProviderError)) else "Provisioning failed (private details suppressed)", file=sys.stderr)
        sys.exit(1)
