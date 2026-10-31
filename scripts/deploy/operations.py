"""One application interface to fixed Infrastructure operations; no remote shell."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from environment import load, ROOT
from release_settings import configuration_hash


class OperationError(ValueError):
    pass


def transport(request, config, timeout=1300):
    slug = request['project']
    directory = os.environ.get('RUNNER_TEMP')
    if not directory:
        raise ValueError('Set RUNNER_TEMP and run scripts/deploy/access.sh with the named deployment key and pinned host key')
    ssh_config = Path(directory) / (slug + '-access/config')
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(['ssh', '-F', str(ssh_config), '-o', 'BatchMode=yes',
                                     '-o', 'ConnectTimeout=10', slug + '-vps', 'operate'],
                                    input=json.dumps(request).encode(), stdout=output,
                                    stderr=subprocess.DEVNULL, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError('Outcome unknown; inspect status before retrying') from None
        output.seek(0)
        raw = output.read(65537)
    if result.returncode or len(raw) > 65536:
        try:
            code=json.loads(raw).get('code')
        except (ValueError,AttributeError):code=None
        if code in {'OWNER_ACTION_REQUIRED','HOST_STATE_CHANGED','READBACK_REQUIRED','APPROVAL_REPLAY','UNSUPPORTED_CAPABILITY','OTHER_ENVIRONMENT_CHANGED'}:
            raise OperationError(code+': inspect the plan and Infrastructure operations guide before retrying')
        raise OperationError('Operation rejected or outcome unknown; inspect status and the Infrastructure runbook')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('Invalid controller response')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'plan', 'status', 'check', 'rollback', 'backup', 'restore'])
    parser.add_argument('environment', choices=['staging', 'prod', 'production'])
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--image')
    parser.add_argument('--controller-checksum', help='Observed installed dispatcher checksum for a controller plan')
    parser.add_argument('--plan-id')
    parser.add_argument('--backup-id')
    parser.add_argument('--destination')
    args = parser.parse_args()
    target = 'prod' if args.environment == 'production' else args.environment
    config = load(target, require_connections=args.action in ('plan','check','rollback'))
    slug = json.loads((ROOT / 'project.config.json').read_text())['slug']
    if args.action == 'doctor':
        try:
            load(target)  # Validate all public bindings, without contacting providers.
        except ValueError as error:
            message=str(error)
            if re.fullmatch(r'Missing public configuration: [A-Za-z0-9_., ]+',message):
                raise OperationError(message) from None
            raise
        print(json.dumps({'configuration': 'valid', 'target': target,
                          'configurationHash': configuration_hash(config),
                          'requiredController': 2, 'hostInstallation': 'not verified'}))
        return
    request = dict(version=2, project=slug, environment=target, action=args.action)
    if args.action in ('check', 'rollback'):
        request['configurationHash'] = configuration_hash(config)
        # These operations produce the existing bounded release report, not plan JSON.
        subprocess.run(['bash', str(Path(__file__).with_name('host-operation.sh')),
                        args.action, args.environment], check=True)
        return
    if args.action == 'plan':
        if not args.bundle or not args.manifest or not args.image:
            parser.error('plan requires --bundle, --manifest and immutable --image')
        manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
        raw = args.bundle.read_bytes()
        if hashlib.sha256(raw).hexdigest() != manifest['bundleChecksum']:
            raise ValueError('Bundle checksum differs from reviewed manifest')
        request.update(bundle=base64.b64encode(raw).decode(), candidate=dict(
            project=slug, environment=target, sourceCommit=manifest['sourceCommit'], image=args.image,
            bundleChecksum=manifest['bundleChecksum'], configurationHash=configuration_hash(config),
            classification='host-configuration', changedSettings=[], credentialReferences=[]))
        if manifest.get('classification')=='controller':
            if not args.controller_checksum or not re.fullmatch('[a-f0-9]{64}',args.controller_checksum):
                parser.error('controller plan requires the observed --controller-checksum')
            request['candidate'].update(classification='controller',controllerExpectedChecksum=args.controller_checksum)

    elif args.action == 'status':
        if not args.plan_id or not re.fullmatch('[a-f0-9]{64}', args.plan_id):
            parser.error('status requires the exact --plan-id')
        request['planId'] = args.plan_id
    elif args.action in ('backup', 'restore'):
        request.update(backupId=args.backup_id, destination=args.destination)
    print(json.dumps(transport(request, config), indent=2))


if __name__ == '__main__':
    try:
        main()
    except OperationError as error:
        raise SystemExit(str(error)) from None
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError):
        raise SystemExit('Operation stopped; validate public inputs and inspect status. Private details suppressed.') from None
