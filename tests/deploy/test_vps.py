"""Host tests run only in an owned Linux container with mocked external services."""
import json
import hashlib
import os
import shutil
import subprocess
import unittest
from pathlib import Path
from test_config import fixture

ROOT = Path("/opt/unibase")
CONFIG = Path("/etc/unibase")
STATE = Path("/var/lib/unibase")
REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/deploy/vps.sh"
PUBLIC = json.loads((REPO / 'deploy/environments/staging.json').read_text())
IMAGE = PUBLIC['deployment']['imageRepository'] or 'ghcr.io/test/unibase'


@unittest.skipUnless(os.environ.get("UNIBASE_DEPLOY_TEST_CONTAINER") == "1" and str(REPO) == "/repo", "Requires owned Linux test container")
class HostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert not ROOT.exists() and not CONFIG.exists() and not STATE.exists()
        cls.bin = Path("/tmp/unibase-mock-bin")
        cls.bin.mkdir()
        mocks = {
            "docker": '''#!/usr/bin/env python3
import json,os,sys,time
from pathlib import Path
args=sys.argv[1:]
with open('/tmp/docker-operations','a') as f: f.write(json.dumps(args)+'\\n')
if args[:1]==['--config']:
    assert args[2]=='pull'
    sys.exit(1 if os.environ.get('FAIL_ANONYMOUS_PULL')=='1' else 0)
if args[0]=='login': sys.exit(0)
if args[:2]==['image','inspect']:
    print(os.environ.get('BAD_IMAGE_REVISION') or Path('/tmp/pulled-commit').read_text())
    sys.exit(0)
if args[:2]==['buildx','build']:
    if os.environ.get('FAIL_BUILD')=='1': sys.exit(1)
    Path(args[args.index('--metadata-file')+1]).write_text(json.dumps({'containerimage.digest':'sha256:'+'b'*64}))
    Path('/tmp/docker-built').touch()
    sys.exit(0)
if args==['compose','version']: print('Docker Compose version v2.35.0'); sys.exit(0)
project=args[args.index('--project-name')+1]
if project not in ('unibase-staging','unibase-production'): sys.exit(99)
env=Path(args[args.index('--env-file')+1])
if 'exec' in args:
    if 'worker-healthcheck.cjs' not in args: sys.exit(99)
    values=dict(line.split('=',1) for line in env.read_text().splitlines())
    if os.environ.get('FAIL_WORKER_COMMIT')==values['RELEASE_COMMIT']: sys.exit(1)
if 'pull' in args and os.environ.get('FAIL_PULL')=='1': sys.exit(1)
if 'pull' in args:
    values=dict(line.split('=',1) for line in env.read_text().splitlines())
    Path('/tmp/pulled-commit').write_text(values['RELEASE_COMMIT'])
if 'up' in args:
    if os.environ.get('HOLD_UP')=='1':
        Path('/tmp/hold-up-started').touch()
        time.sleep(0.6)
    Path('/tmp/active-'+project).write_text(env.read_text())
    with open('/tmp/docker-operations','a') as f: f.write(json.dumps(['up-complete',project])+'\\n')
if 'down' in args: Path('/tmp/active-'+project).unlink(missing_ok=True)
''',
            "curl": '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
url=sys.argv[-1]
if url.startswith('https://github.com/cloudflare/cloudflared/releases/'):
    Path(sys.argv[sys.argv.index('--output')+1]).write_text('#!/bin/sh\\nexit 0\\n')
    sys.exit(0)
target='staging' if ('35101' in url or 'staging.' in url) else 'production'
active=Path('/tmp/active-unibase-'+target)
if not active.exists(): sys.exit(22)
env=dict(x.split('=',1) for x in active.read_text().splitlines())
commit=env['RELEASE_COMMIT']
if os.environ.get('FAIL_COMMIT')==commit: sys.exit(22)
if url.startswith('https:') and os.environ.get('FAIL_HTTPS_COMMIT')==commit: sys.exit(22)
print(json.dumps({'status':'ready','commit':commit}))
''',
            "sleep": "#!/usr/bin/env bash\nexit 0\n",
            "gh": '''#!/usr/bin/env python3
import io,json,os,sys,zipfile
from pathlib import Path
endpoint=sys.argv[2]
commit=os.environ['GITHUB_SHA']
if '/git/ref/' in endpoint:
    print('f'*40 if os.environ.get('STALE_AFTER_BUILD')=='1' and Path('/tmp/docker-built').exists() else os.environ['MOCK_REMOTE_SHA'])
elif '/workflows/' in endpoint:
    print(json.dumps({'workflow_runs':[{'head_sha':commit,'status':'completed','id':1}]}))
elif endpoint.endswith('/artifacts'):
    print(json.dumps({'artifacts':[{'name':'quality-'+commit,'expired':False,'id':2}]}))
elif endpoint.endswith('/zip'):
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as z: z.writestr('results.json',json.dumps([{'name':'lint','exitCode':1,'outcome':'warning'}]))
    sys.stdout.buffer.write(data.getvalue())
else: sys.exit(1)
''',
            "python3": '''#!/usr/bin/env bash
if [[ ${1:-} == *public-package.py ]]; then
  exec /usr/bin/python3 /tmp/unibase-mock-bin/package-api.py "$@"
fi
if [[ ${1:-} == *routes.py ]]; then exit 0; fi
exec /usr/bin/python3 "$@"
''',
            "ssh": '''#!/usr/bin/env bash
printf 'ssh\\n' >> /tmp/host-contacts
if [[ ${!#} == operate ]]; then
  exec /usr/bin/python3 /tmp/unibase-mock-bin/dispatch.py
fi
bash -c "${!#}"
''',
            "scp": '''#!/usr/bin/env bash
printf 'scp\\n' >> /tmp/host-contacts
cp -- "$3" "${4#unibase-vps:}"
''',
            "sudo": '''#!/usr/bin/env bash
[[ ${1:-} != -n ]] || shift
exec "$@"
''',
        }
        for name, content in mocks.items():
            file = cls.bin / name
            file.write_text(content)
            file.chmod(0o755)
        (cls.bin / "package-api.py").write_text('''import io,json,os,runpy,sys,urllib.request
def response(request, **kwargs):
    value={'type':'Organization'} if '/users/' in request.full_url else {'visibility':os.environ.get('MOCK_VISIBILITY','public')}
    return io.BytesIO(json.dumps(value).encode())
urllib.request.urlopen=response
filename=sys.argv[1]
sys.argv=sys.argv[1:]
runpy.run_path(filename,run_name='__main__')
''')
        (cls.bin / "dispatch.py").write_text('''import json,subprocess,sys
r=json.load(sys.stdin)
assert set(r)=={'version','project','environment','action','configurationHash','image','commit'}
assert r['environment']=='staging' and r['project']=='unibase' and r['action']=='deploy'
sys.exit(subprocess.run(['bash','/repo/scripts/deploy/vps.sh','deploy','staging','--apply',r['image'],r['commit']]).returncode)
''')
        cls.env = dict(os.environ, PATH=f"{cls.bin}:" + os.environ["PATH"])
        # Preview must not create directories or contact Docker.
        result = subprocess.run(["bash", SCRIPT, "setup", "staging"], env=cls.env, capture_output=True)
        assert result.returncode == 0 and not ROOT.exists()
        assert not Path("/tmp/docker-operations").exists()
        result = cls.run_host("setup", "staging")
        assert result.returncode == 0 and not (ROOT / "production").exists()
        assert cls.run_host("setup", "production").returncode == 0

    @classmethod
    def run_host(cls, action, target="staging", commit=None, **extra):
        args = ["bash", str(SCRIPT), action, target, "--apply"]
        if commit:
            args += [IMAGE + "@sha256:" + "b" * 64, commit]
        return subprocess.run(args, env=dict(cls.env, **extra), capture_output=True, text=True, timeout=20)

    def setUp(self):
        for target in ("staging", "production"):
            for link in ("current", "previous"):
                (ROOT / target / link).unlink(missing_ok=True)
            shutil.rmtree(ROOT / target / "releases")
            (ROOT / target / "releases").mkdir()
            Path("/tmp/active-unibase-" + target).unlink(missing_ok=True)
        installed=fixture(CONFIG)
        item=installed['staging']
        for key,value in {'origin':PUBLIC['runtime']['APP_ORIGIN'],'firebaseProject':PUBLIC['google']['projectId'],**{k:PUBLIC['deployment'][k] for k in ('ingressSubnet','redisImage','nginxImage')}}.items():
            if value is not None: item[key]=value
        installed['imageRepository']=IMAGE
        (CONFIG/'config.json').write_text(json.dumps(installed))
        runtime=CONFIG/'staging/runtime.env'
        values=dict(line.split('=',1) for line in runtime.read_text().splitlines())
        values.update(APP_ORIGIN=item['origin'],FIREBASE_PROJECT_ID=item['firebaseProject'])
        runtime.write_text(''.join(f'{k}={v}\n' for k,v in values.items()))
        credential=CONFIG/'staging/firebase.json'; saved=json.loads(credential.read_text()); saved['project_id']=item['firebaseProject']; credential.write_text(json.dumps(saved))
        Path("/tmp/docker-operations").write_text("")
        Path("/tmp/docker-built").unlink(missing_ok=True)
        Path("/tmp/host-contacts").write_text("")
        Path("/tmp/hold-up-started").unlink(missing_ok=True)

    def release(self, commit, **extra):
        result = self.run_host("deploy", commit=commit, **extra)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return (ROOT / "staging/current").resolve()

    def test_failed_readiness_restores_matching_configuration_and_image(self):
        previous = self.release("a" * 40)
        snapshot = (previous / "runtime.env").read_bytes()
        runtime = CONFIG / "staging/runtime.env"
        runtime.write_text(runtime.read_text().replace("test-public-key", "new-public-key"))
        failed = self.run_host("deploy", commit="b" * 40, FAIL_COMMIT="b" * 40)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("result=restored", failed.stdout)
        self.assertEqual((ROOT / "staging/current").resolve(), previous)
        self.assertEqual((previous / "runtime.env").read_bytes(), snapshot)
        self.assertIn("a" * 40, Path("/tmp/active-unibase-staging").read_text())

    def test_external_https_failure_also_restores(self):
        previous = self.release("a" * 40)
        failed = self.run_host("deploy", commit="b" * 40, FAIL_HTTPS_COMMIT="b" * 40)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual((ROOT / "staging/current").resolve(), previous)
        self.assertIn("result=restored", failed.stdout)

    def test_rollback_retains_matching_credentials_without_data_operations(self):
        previous = self.release("a" * 40)
        original = (previous / "firebase.json").read_bytes()
        (CONFIG / "staging/firebase.json").write_text((CONFIG / "staging/firebase.json").read_text().replace("synthetic-fixture", "rotated-synthetic-key"))
        self.release("b" * 40)
        result = self.run_host("rollback")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((ROOT / "staging/current").resolve(), previous)
        self.assertEqual((previous / "firebase.json").read_bytes(), original)
        operations = Path("/tmp/docker-operations").read_text()
        for row in map(json.loads, operations.splitlines()):
            if "exec" in row:
                self.assertIn("worker-healthcheck.cjs", row)
        self.assertNotIn('"run"', operations)

    def test_pull_failure_never_replaces_existing_application(self):
        previous = self.release("a" * 40)
        Path("/tmp/docker-operations").write_text("")
        result = self.run_host("deploy", commit="b" * 40, FAIL_PULL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((ROOT / "staging/current").resolve(), previous)
        self.assertNotIn('"up"', Path("/tmp/docker-operations").read_text())

    def test_failed_worker_restores_previous_release(self):
        previous = self.release("a" * 40)
        result = self.run_host("deploy", commit="b" * 40, FAIL_WORKER_COMMIT="b" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((ROOT / "staging/current").resolve(), previous)
        self.assertIn("result=restored", result.stdout)

    def test_first_failure_stops_failed_project(self):
        result = self.run_host("deploy", commit="b" * 40, FAIL_COMMIT="b" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((ROOT / "staging/current").exists())
        self.assertFalse(Path("/tmp/active-unibase-staging").exists())

    def test_staging_operations_never_touch_production_or_poc(self):
        result = self.run_host("deploy", target="production", commit="c" * 40)
        self.assertEqual(result.returncode, 0)
        production = (ROOT / "production/current").resolve()
        snapshot = (production / "compose.env").read_bytes()
        Path("/tmp/docker-operations").write_text("")
        self.release("a" * 40)
        operations = Path("/tmp/docker-operations").read_text()
        self.assertNotIn("unibase-production", operations)
        self.assertNotIn("kids-booklet", operations)
        self.assertEqual((production / "compose.env").read_bytes(), snapshot)
        (ROOT / "staging/previous").symlink_to(production)
        Path("/tmp/docker-operations").write_text("")
        self.assertNotEqual(self.run_host("rollback").returncode, 0)
        self.assertNotIn('"up"', Path("/tmp/docker-operations").read_text())

    def test_guard_rejects_wrong_environment_branch_and_stale_commit(self):
        guard = REPO / "scripts/deploy/guard.sh"
        env = dict(self.env, GITHUB_REPOSITORY="test/unibase", GITHUB_SHA="a" * 40, MOCK_REMOTE_SHA="a" * 40)
        for target, branch, sha, expected in (("staging", "_staging", "a", 0), ("production", "_staging", "a", 1), ("staging", "_prod", "a", 1), ("staging", "_staging", "b", 1)):
            result = subprocess.run(["bash", guard, target], env=dict(env, GITHUB_REF="refs/heads/" + branch, MOCK_REMOTE_SHA=sha * 40), capture_output=True)
            self.assertEqual(result.returncode, expected)

    def run_release(self, **extra):
        runner = Path("/tmp/unibase-release-runner")
        if runner.exists():
            shutil.rmtree(runner)
        runner.mkdir()
        env = dict(self.env, GITHUB_REPOSITORY=IMAGE.removeprefix('ghcr.io/'), GITHUB_SHA="a" * 40,
                   GITHUB_REF="refs/heads/_staging", MOCK_REMOTE_SHA="a" * 40,
                   GITHUB_ACTOR="synthetic-operator", GH_TOKEN="synthetic-test-token",
                   VPS_HOST="ssh.example.test", VPS_USER="unibase", RUNNER_TEMP=str(runner),
                   CLOUDFLARED_VERSION="2026.1.0", CLOUDFLARED_SHA256=hashlib.sha256(b"#!/bin/sh\nexit 0\n").hexdigest(),
                   DEPLOY_SSH_PRIVATE_KEY="synthetic-private-key", DEPLOY_SSH_HOST_KEY="ssh-ed25519 synthetic-host-key",
                   CF_ACCESS_CLIENT_ID="synthetic-access-id", CF_ACCESS_CLIENT_SECRET="synthetic-access-secret",
                   GITHUB_ENV=str(runner / "github-env"), GITHUB_STEP_SUMMARY=str(runner / "summary"))
        return subprocess.run(["bash", REPO / "scripts/deploy/release.sh", "staging"], cwd=REPO,
                              env=dict(env, **extra), capture_output=True, text=True, timeout=30)

    def test_quality_warning_permits_successful_build_and_deployment(self):
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("a" * 40, (ROOT / "staging/current/compose.env").read_text())
        self.assertIn("Built successfully with quality warnings", Path("/tmp/unibase-release-runner/summary").read_text())
        self.assertIn("ssh", Path("/tmp/host-contacts").read_text())

    def test_failed_build_never_contacts_host(self):
        result = self.run_release(FAIL_BUILD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(Path("/tmp/host-contacts").read_text(), "")
        self.assertFalse((ROOT / "staging/current").exists())

    def test_commit_changed_during_build_never_contacts_host(self):
        result = self.run_release(STALE_AFTER_BUILD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(Path("/tmp/host-contacts").read_text(), "")

    def test_private_package_is_rejected_without_changing_visibility(self):
        result = self.run_release(MOCK_VISIBILITY="private")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("visibility to public", result.stderr)
        self.assertEqual(Path("/tmp/host-contacts").read_text(), "")
        self.assertFalse(Path("/tmp/docker-built").exists())

    def test_anonymous_pull_failure_never_contacts_host(self):
        result=self.run_release(FAIL_ANONYMOUS_PULL="1")
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(Path('/tmp/host-contacts').read_text(),'')
        self.assertTrue(Path('/tmp/docker-built').exists())

    def test_host_lock_serializes_competing_releases(self):
        args = ["bash", str(SCRIPT), "deploy", "staging", "--apply",
                IMAGE + "@sha256:" + "b" * 64, "a" * 40]
        first = subprocess.Popen(args, env=dict(self.env, HOLD_UP="1"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        import time
        try:
            deadline = time.monotonic() + 10
            while not Path("/tmp/hold-up-started").exists() and time.monotonic() < deadline:
                if first.poll() is not None:
                    out, error = first.communicate()
                    self.fail(out + error)
                time.sleep(0.02)
            self.assertTrue(Path("/tmp/hold-up-started").exists())
            second = self.run_host("deploy", commit="b" * 40)
            out, error = first.communicate(timeout=10)
            self.assertEqual(first.returncode, 0, out + error)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            current = (ROOT / "staging/current").resolve()
            previous = (ROOT / "staging/previous").resolve()
            self.assertIn("b" * 40, (current / "compose.env").read_text())
            self.assertIn("a" * 40, (previous / "compose.env").read_text())
            operations = [json.loads(line) for line in Path("/tmp/docker-operations").read_text().splitlines()]
            up = [i for i, row in enumerate(operations) if "up" in row]
            completed = [i for i, row in enumerate(operations) if row[0] == "up-complete"]
            self.assertLess(up[0], completed[0])
            self.assertLess(completed[0], up[1])
        finally:
            if first.poll() is None: first.kill()
            first.communicate()

    def test_invalid_credentials_stop_before_image_pull(self):
        (CONFIG / "staging/firebase.json").write_text("{}")
        result = self.run_host("deploy", commit="a" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('"pull"', Path("/tmp/docker-operations").read_text())
        self.assertFalse((ROOT / "staging/current").exists())

    def test_infrastructure_changes_require_provisioning_before_pull(self):
        installed = json.loads((CONFIG / "config.json").read_text())
        installed["staging"]["port"] = 35103
        (CONFIG / "config.json").write_text(json.dumps(installed))
        result = self.run_host("deploy", commit="a" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("provision", result.stderr)
        self.assertNotIn('"pull"', Path("/tmp/docker-operations").read_text())

    def test_image_revision_mismatch_never_replaces_application(self):
        previous = self.release("a" * 40)
        Path("/tmp/docker-operations").write_text("")
        result = self.run_host("deploy", commit="b" * 40, BAD_IMAGE_REVISION="c" * 40)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((ROOT / "staging/current").resolve(), previous)
        self.assertNotIn('"up"', Path("/tmp/docker-operations").read_text())

    def test_setup_is_idempotent_and_check_without_release_fails(self):
        before = (CONFIG / "staging/runtime.env").read_bytes()
        self.assertEqual(self.run_host("setup").returncode, 0)
        self.assertEqual((CONFIG / "staging/runtime.env").read_bytes(), before)
        result = self.run_host("check")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("result=healthy", result.stdout)
