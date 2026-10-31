"""Read-only host compatibility check; never print untrusted SSH output."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

FIELDS = {'version', 'code', 'compatible', 'installedRevision',
          'installedConfigurationHash', 'requestedConfigurationHash'}
CODES = {'COMPATIBLE', 'CONFIGURATION_MISMATCH', 'INVALID_REQUEST',
         'MISSING_REGISTRATION', 'UNTRUSTED_CONTROL', 'INTERNAL_FAILURE',
         'IMAGE_REPOSITORY_MISMATCH', 'UNSUPPORTED_CAPABILITY', 'LOCK_TIMEOUT', 'OPERATION_REJECTED'}
RUNBOOK = 'https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md#deployment-preflight'


def validate_response(raw, requested_hash, returncode, version=1):
    if len(raw) > 4096:
        raise ValueError('Oversized response')
    value = json.loads(raw)
    if (not isinstance(value, dict) or set(value) != FIELDS or
            type(value['version']) is not int or value['version'] != version or
            not isinstance(value['code'], str) or value['code'] not in CODES or
            type(value['compatible']) is not bool or
            value['compatible'] != (value['code'] == 'COMPATIBLE') or
            value['requestedConfigurationHash'] != requested_hash):
        raise ValueError('Invalid preflight response')
    for name in ('installedRevision', 'installedConfigurationHash'):
        item = value[name]
        if item is not None and (not isinstance(item, str) or not re.fullmatch(r'[a-f0-9]{64}', item)):
            raise ValueError('Invalid identity')
    if value['code'] in ('COMPATIBLE', 'CONFIGURATION_MISMATCH'):
        if not value['installedRevision'] or not value['installedConfigurationHash']:
            raise ValueError('Missing identity')
        if value['compatible'] != (value['installedConfigurationHash'] == requested_hash):
            raise ValueError('Inconsistent identity')
    expected_status = 0 if value['compatible'] else 1 if value['code'] == 'INTERNAL_FAILURE' else 2
    if returncode != expected_status:
        raise ValueError('Inconsistent exit status')
    return value


def check(request, ssh_config, alias, timeout=45):
    if request.get('version') == 2:
        capability_request = {key: request[key] for key in ('version', 'project', 'environment')}
        capability_request['action'] = 'capabilities'
        try:
            with tempfile.TemporaryFile() as capability_output:
                capability_result = subprocess.run(['ssh', '-F', str(ssh_config), '-o', 'BatchMode=yes',
                    '-o', 'ConnectTimeout=10', alias, 'operate'], input=json.dumps(capability_request).encode(),
                    stdout=capability_output, stderr=subprocess.DEVNULL, timeout=timeout)
                capability_output.seek(0)
                capability_raw = capability_output.read(4097)
            capabilities = json.loads(capability_raw)
            if capability_result.returncode or len(capability_raw) > 4096 or capabilities.get('version') != 2 or not {'operation-lock-v1', 'image-retention-v1'}.issubset(capabilities.get('capabilities', [])):
                raise ValueError('Unsupported controller')
        except (OSError, ValueError, TypeError, AttributeError, subprocess.TimeoutExpired):
            return 'rejected', 'Controller capability discovery failed; install image-retention-v1 before release. ' + RUNBOOK
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(['ssh', '-F', str(ssh_config), '-o', 'BatchMode=yes',
                                     '-o', 'ConnectTimeout=10', alias, 'operate'],
                                    input=json.dumps(request).encode(), stdout=output,
                                    stderr=subprocess.DEVNULL, timeout=timeout)
        except subprocess.TimeoutExpired:
            return 'unknown', 'Preflight timed out; compatibility unknown. No deployment attempted.'
        except OSError:
            return 'unknown', 'Preflight transport unavailable. No deployment attempted.'
        output.seek(0)
        try:
            result = validate_response(output.read(4097), request['configurationHash'], result.returncode, request.get('version', 1))
        except (ValueError, TypeError, KeyError):
            return 'unknown', ('Preflight unavailable: SSH failure, malformed response or older dispatcher. '
                               'Install/verify the compatible dispatcher before release. ' + RUNBOOK)
    identities = ' '.join(f'{key}={result[key] or "unavailable"}' for key in
                          ('installedRevision', 'installedConfigurationHash', 'requestedConfigurationHash'))
    if result['compatible']:
        return 'compatible', 'Host compatibility verified. ' + identities
    if result['code'] == 'INTERNAL_FAILURE':
        return 'unknown', 'Host preflight failed internally; inspect the installed control. ' + identities + ' ' + RUNBOOK
    action = ('Operator configuration update required.' if result['code'] == 'CONFIGURATION_MISMATCH'
              else 'Operator inspection required; release not attempted.')
    return 'rejected', f'{result["code"]}: {action} {identities} {RUNBOOK}'


def main():
    script = Path(__file__).with_name('dispatch-request.py')
    request = json.loads(subprocess.check_output([sys.executable, str(script), 'preflight', os.environ.get('TARGET', 'staging')]))
    if len(sys.argv) == 3:
        # Classify only a complete bounded rejection envelope, never arbitrary log lines.
        try:
            with open(sys.argv[1], 'rb') as log:
                value = validate_response(log.read(4097), request['configurationHash'], int(sys.argv[2]), request.get('version', 1))
            print('rejected' if value['code'] not in ('COMPATIBLE', 'INTERNAL_FAILURE') else 'unknown')
        except (OSError, ValueError, TypeError, KeyError):
            print('unknown')
        return 0
    project = request['project']
    state, message = check(request, Path(os.environ['RUNNER_TEMP']) / (project + '-access/config'), project + '-vps')
    print(message)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as summary:
            summary.write(f'Compatibility: {state}. {message}\n')
    return 0 if state == 'compatible' else 2 if state == 'rejected' else 1


if __name__ == '__main__':
    sys.exit(main())
