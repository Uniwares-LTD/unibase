"""Exercise the actual release shell with disposable command fixtures on Windows/Linux."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

BASH = shutil.which('bash') if os.name != 'nt' else 'C:/Program Files/Git/bin/bash.exe'
REPO = Path(__file__).resolve().parents[2]


@unittest.skipUnless(BASH and Path(BASH).is_file(), 'Bash unavailable')
class ReleaseSequenceTests(unittest.TestCase):
    def run_release(self, failure=''):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'bin').mkdir()
            shutil.copyfile(REPO / 'scripts/deploy/release.sh', root / 'release.sh')
            fixtures = {
                'guard.sh': '#!/usr/bin/env bash\nexit 0\n',
                'access.sh': '#!/usr/bin/env bash\necho access >> "$RUNNER_TEMP/events"\n',
                'host-operation.sh': '#!/usr/bin/env bash\necho deploy >> "$RUNNER_TEMP/events"\n[[ "$FAIL_AT" != deploy ]]\n',
                'bin/docker': '''#!/usr/bin/env bash
echo "docker:$1" >> "$RUNNER_TEMP/events"
[[ "$FAIL_AT" != build || "$1" != buildx ]]
''',
                'bin/python3': '''#!/usr/bin/env bash
case "$1" in
  *preflight.py)
    if [[ $# == 3 ]]; then echo unknown; exit 0; fi
    echo preflight >> "$RUNNER_TEMP/events"
    [[ "$FAIL_AT" != preflight ]] || exit 2
    [[ "$FAIL_AT" != transport ]] || exit 1
    ;;
  -c) printf 'sha256:%064d\\n' 0 ;;
esac
''',
            }
            for name, content in fixtures.items():
                path = root / name
                path.write_text(content, encoding='utf-8', newline='\n')
                path.chmod(0o755)
            env = dict(os.environ, RUNNER_TEMP=root.as_posix(), GITHUB_STEP_SUMMARY=(root/'summary').as_posix(),
                       GITHUB_SHA='a'*40, GITHUB_REPOSITORY='test/unibase', GITHUB_ACTOR='fixture',
                       GH_TOKEN='fixture', VPS_HOST='fixture', VPS_USER='fixture',
                       DEPLOY_SSH_PRIVATE_KEY='fixture', DEPLOY_SSH_HOST_KEY='fixture', FAIL_AT=failure)
            result = subprocess.run([BASH, '-c', 'export PATH="$PWD/bin:$PATH"; bash release.sh staging'],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=20)
            events = (root/'events').read_text(encoding='utf-8') if (root/'events').exists() else ''
            summary = (root/'summary').read_text(encoding='utf-8') if (root/'summary').exists() else ''
            return result, events, summary

    def test_rejection_or_unknown_transport_stops_before_registry(self):
        for failure, state in [('preflight', 'rejected'), ('transport', 'unknown')]:
            result, events, summary = self.run_release(failure)
            self.assertNotEqual(result.returncode, 0, result.stderr)
            self.assertEqual(events.splitlines(), ['access', 'preflight'])
            self.assertIn('compatibility='+state, summary)
            self.assertIn('deployment=not_attempted', summary)

    def test_matching_preflight_precedes_build_and_deployment(self):
        result, events, summary = self.run_release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertLess(events.index('preflight'), events.index('docker:login'))
        self.assertLess(events.index('docker:buildx'), events.index('deploy'))
        self.assertIn('readiness=healthy', summary)

    def test_build_failure_never_deploys_and_host_failure_is_unknown(self):
        result, events, summary = self.run_release('build')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('deploy', events)
        self.assertIn('deployment=not_attempted', summary)
        result, events, summary = self.run_release('deploy')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('deployment=unknown readiness=unknown', summary)
