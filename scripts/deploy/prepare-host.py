"""Operator-only initial staging configuration using existing provider credentials.

Runs from the reviewed root-owned control checkout. It creates no cloud resources,
keys or registry credentials, and does not start application containers.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import stat
import re
import subprocess
import sys
import tempfile
from ipaddress import ip_network
from environment import ROOT, load
from provision import Host, host_config, private_write
from config import validate


def trusted_existing(path):
    for entry in [path, *path.parents]:
        if entry.exists() or entry.is_symlink():
            info = entry.lstat()
            if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Unsafe configuration ownership or path')


def materialize(config, credentials, destination, redis_password):
    if set(credentials) - {'redisPassword', 'ai'} != {'firebase', 'mongodbUri', 'firebaseApiKey', 'firebaseAppId'}:
        raise ValueError('Expected firebase, mongodbUri, firebaseApiKey and firebaseAppId')
    if 'redisPassword' in credentials and (not isinstance(credentials['redisPassword'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{43,256}', credentials['redisPassword']) or credentials['redisPassword'] != redis_password):
        raise ValueError('Prepared Redis credential differs or has invalid format')
    runtime = {k: v for k, v in config['runtime'].items() if v is not None}
    runtime.update(FIREBASE_API_KEY=credentials['firebaseApiKey'], FIREBASE_APP_ID=credentials['firebaseAppId'],
                   MONGODB_URI=credentials['mongodbUri'], REDIS_URL='redis://default:' + redis_password + '@redis:6379')
    ai = credentials.get('ai', {})
    if not isinstance(ai, dict):
        raise ValueError('AI credentials must be an explicit allowlisted object')
    for key, value in ai.items():
        if key not in {'DIFY_MANAGEMENT_KEY', 'DIFY_CREDENTIAL_ENCRYPTION_KEY', 'PERSONA_COMPLETION_API_KEY'} and not re.fullmatch(r'(DIFY_KEY_|MCP_TOKEN_)[A-Z0-9_]+', key):
            raise ValueError('AI input contains a forbidden field')
        if not isinstance(value, str) or not value:
            raise ValueError('Missing AI credential')
    runtime.update(ai)
    for value in runtime.values():
        if not isinstance(value, str) or any(c in value for c in '\r\n\0'):
            raise ValueError('Invalid runtime value')
    if runtime.get('PAYMENTS_MODE', 'disabled') != 'disabled' or runtime.get('ASSET_STORE', 'mongo') != 'mongo':
        raise ValueError('Initial staging requires payments disabled and MongoDB assets')
    if runtime.get('DIFY_MODE', 'disabled') == 'live' or runtime.get('MCP_ENABLED', 'false') == 'true':
        if not re.fullmatch(r'[a-fA-F0-9]{64}', ai.get('DIFY_CREDENTIAL_ENCRYPTION_KEY', '')):
            raise ValueError('AI activation requires a retained explicit encryption key')
    directory = destination / 'staging'
    directory.mkdir(mode=0o700)
    private_write(destination / 'config.json', json.dumps(host_config(ROOT)))
    private_write(directory / 'runtime.env', ''.join(f'{k}={v}\n' for k, v in sorted(runtime.items())))
    private_write(directory / 'firebase.json', json.dumps(credentials['firebase']))
    private_write(directory / 'redis-password', redis_password)
    validate(destination, 'staging')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--credentials', required=True, type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--indexes', action='store_true', help='Explicit additive index preparation after bindings exist')
    parser.add_argument('--migrate', action='store_true', help='Prepare indexes, then apply pending forward-only data migrations; take the operational backup first')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Run through the reviewed operator installation, not the deploy account')
    os.umask(0o077)
    config = load('staging')
    slug = json.loads((ROOT / 'project.config.json').read_text())['slug']
    host = Host(config, slug)
    trusted_existing(host.directory)
    host.preflight()
    desired = ip_network(config['deployment']['ingressSubnet'])
    routes = json.loads(subprocess.check_output(['ip', '-j', '-4', 'route', 'show', 'table', 'all'], text=True))
    # Initial binding only. Existing deployments require an operator-reviewed update.
    for route in routes:
        dst = route.get('dst', 'default')
        if dst != 'default' and ip_network(dst, strict=False).overlaps(desired):
            raise ValueError('Proposed subnet overlaps a host route; inspect existing app ownership before updating')
    credentials = json.loads(args.credentials.read_text())
    existing = host.directory / 'redis-password'
    trusted_existing(existing)
    password = existing.read_text().strip() if existing.exists() else credentials.get('redisPassword', secrets.token_urlsafe(32))
    with tempfile.TemporaryDirectory(prefix=slug + '-prepare-') as temporary:
        candidate = Path(temporary)
        materialize(config, credentials, candidate, password)
        # Persist the generated password first so an interrupted apply reuses it.
        files = ['staging/redis-password', 'config.json', 'staging/runtime.env', 'staging/firebase.json']
        for name in files:
            target = host.root / name
            trusted_existing(target)
            if target.exists() and target.read_bytes() != (candidate / name).read_bytes():
                raise ValueError('Existing configuration differs; preserve it and review an update separately')
        if not args.apply:
            print('Preview passed: existing-provider credentials validate; additive local config/index preparation only')
            return
        host.prepare()
        for name in files:
            if not (host.root / name).exists():
                private_write(host.root / name, (candidate / name).read_text())
        subprocess.run(['/bin/bash', str(ROOT / 'scripts/deploy/vps.sh'), 'setup', 'staging', '--apply'], check=True)
        if args.indexes or args.migrate:
            host.indexes(ROOT, migrate=args.migrate)
        print('Private staging configuration installed; application deployment remains separate')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit('Staging preparation failed; inspect bindings/permissions with the operator (private values suppressed)')
