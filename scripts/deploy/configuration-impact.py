"""Advisory host-profile diff: setting names only, never configuration values."""
import json
import os
import re
import subprocess
import sys
from release_settings import host_configuration


def changed_names(before, after, prefix=''):
    if isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(before.keys() | after.keys()):
            if not re.fullmatch(r'[A-Za-z0-9_]+', key):
                raise ValueError('Invalid setting name')
            name = prefix + '.' + key if prefix else key
            if key not in before or key not in after:
                result.append(name)
            else:
                result.extend(changed_names(before[key], after[key], name))
        return result
    return [] if before == after else [prefix]


def report(before, after):
    names = changed_names(host_configuration(before), host_configuration(after))
    return ('Host configuration impact (advisory):\n' +
            ('Operator intervention required before release. Changed settings:\n' +
             '\n'.join('- ' + name for name in names) if names else
             'No host-profile change detected; control scripts and provider changes still require review.') + '\n')


def main():
    base, head = sys.argv[1:3]
    if not all(re.fullmatch(r'[a-f0-9]{40}', sha) for sha in (base, head)):
        raise ValueError('Expected commit identities')
    reports=[]
    for target in ('staging','production'):
        configs = [json.loads(subprocess.check_output(['git', 'show', sha + ':deploy/environments/'+target+'.json']))
                   for sha in (base, head)]
        reports.append(target+': '+report(*configs))
    control=subprocess.check_output(['git','diff','--name-only',base,head,'--','scripts/deploy','deploy/compose.yml','deploy/nginx.conf','deploy/contract.json']).decode().splitlines()
    if control:reports.append('Application control/contract changed: review the protected control.bundle update before release.\n')
    text='\n'.join(reports)
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write(text)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('::warning::Host configuration impact unavailable; review operator intervention manually.')
        sys.exit(1)
