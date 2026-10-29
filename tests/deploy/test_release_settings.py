"""Release settings cross the deployment boundary; never include private data."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts/deploy'))
from release_settings import configuration_hash, settings_for, validate_settings
from test_config import fixture, config_module


class ReleaseSettingsTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((REPO / 'deploy/environments/staging.json').read_text())

    def test_flag_is_mutable_but_other_settings_remain_bound(self):
        before = copy.deepcopy(self.config)
        before['runtime'].pop('DIAGNOSTICS_ENABLED', None)
        digest = configuration_hash(before)
        self.assertEqual(digest, configuration_hash(self.config))
        off = copy.deepcopy(self.config)
        off['runtime']['DIAGNOSTICS_ENABLED'] = 'false'
        self.assertEqual(digest, configuration_hash(off))
        for section, key, value in [('runtime', 'APP_ORIGIN', 'https://other.test'),
                                    ('runtime', 'MONGODB_DATABASE', 'other_db'),
                                    ('runtime', 'MCP_ENABLED', 'false'),
                                    ('deployment', 'imageRepository', 'ghcr.io/other/app'),
                                    ('deployment', 'port', 32199)]:
            changed = copy.deepcopy(self.config)
            changed[section][key] = value
            self.assertNotEqual(digest, configuration_hash(changed))

    def test_exact_boolean_strings_and_no_extra_or_missing_fields(self):
        for target in ('local', 'staging', 'production'):
            self.assertEqual(validate_settings({'DIAGNOSTICS_ENABLED': 'false'}, target), {'DIAGNOSTICS_ENABLED': 'false'})
        for value in [True, False, None, 1, 'TRUE', 'true\nAPP_ENV=production', '']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_settings({'DIAGNOSTICS_ENABLED': value}, 'staging')
        for settings in [{}, {'MONGODB_URI': 'canary'}, {'DIAGNOSTICS_ENABLED': 'true', 'APP_ORIGIN': 'https://other.test'}]:
            with self.assertRaises(ValueError): validate_settings(settings, 'staging')
        with self.assertRaises(ValueError): validate_settings({'DIAGNOSTICS_ENABLED': 'true'}, 'production')

    def test_request_carries_only_the_allowlisted_snapshot(self):
        request = json.loads(subprocess.check_output([sys.executable, str(REPO / 'scripts/deploy/dispatch-request.py'),
            'deploy', 'staging', 'ghcr.io/test/app@sha256:' + 'a'*64, 'b'*40], text=True))
        self.assertEqual(request['version'], 2)
        self.assertEqual(request['runtimeSettings'], {'DIAGNOSTICS_ENABLED': 'true'})
        self.assertEqual(request['configurationHash'], configuration_hash(self.config))
        check = json.loads(subprocess.check_output([sys.executable, str(REPO / 'scripts/deploy/dispatch-request.py'), 'check', 'staging'], text=True))
        self.assertNotIn('runtimeSettings', check)

    def test_runtime_merge_preserves_private_values_and_overrides_flag(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / 'runtime.env'
            destination.write_text('MONGODB_URI=private-canary\nREDIS_URL=private-redis\nDIAGNOSTICS_ENABLED=false\n')
            subprocess.check_call([sys.executable, str(REPO / 'scripts/deploy/render-runtime.py'),
                'staging', str(destination), '{"DIAGNOSTICS_ENABLED":"true"}'])
            values = dict(line.split('=', 1) for line in destination.read_text().splitlines())
            self.assertEqual(values['DIAGNOSTICS_ENABLED'], 'true')
            self.assertEqual(values['MONGODB_URI'], 'private-canary')
            before = destination.read_bytes()
            result = subprocess.run([sys.executable, str(REPO / 'scripts/deploy/render-runtime.py'), 'staging',
                str(destination), '{"DIAGNOSTICS_ENABLED":"false","REDIS_URL":"forbidden"}'], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(destination.read_bytes(), before)

    def test_host_validation_rejects_production_enablement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture(root)
            path = root / 'production/runtime.env'
            path.write_text(path.read_text() + 'DIAGNOSTICS_ENABLED=true\n')
            with self.assertRaises(ValueError): config_module.validate(root, 'production')
