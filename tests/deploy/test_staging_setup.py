"""No live providers: destination isolation and resumable credential preparation."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/deploy'))
spec = importlib.util.spec_from_file_location('setup', ROOT / 'scripts/deploy/staging-setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def test_repeated_apply_preserves_generated_credentials(self):
        plan = {'project': 'synthetic-child', 'revision': 'a'*40, 'missingFiles': [], 'invalidFiles': []}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            setup.apply(plan, {}, root, setup.digest(plan))
            files = {p.name: p.read_bytes() for p in (root / 'synthetic-child/staging').iterdir()}
            setup.apply(plan, {}, root, setup.digest(plan))
            self.assertEqual(files, {p.name: p.read_bytes() for p in (root / 'synthetic-child/staging').iterdir()})
            self.assertFalse((root / 'unibase').exists())

    def test_missing_or_changed_preview_has_no_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = {'project': 'child', 'revision': 'a'*40, 'missingFiles': ['atlas-discovery.json'], 'invalidFiles': []}
            for expected in ['wrong', setup.digest(plan)]:
                with self.assertRaises(ValueError):
                    setup.apply(plan, {}, root, expected)
            self.assertEqual(list(root.iterdir()), [])

    def test_conflicting_export_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'secret'
            self.assertEqual(setup.export(path, 'first'), 'first')
            self.assertEqual(setup.export(path, 'replacement'), 'first')

    def test_child_rejects_parent_database_and_web(self):
        revision = 'a'*40
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'project.config.json').write_text(json.dumps({'slug': 'child'}))
            config = {'runtime': {'MONGODB_DATABASE': 'child_staging', 'FIREBASE_PROJECT_ID': 'shared-staging',
                                 'APP_ORIGIN': 'https://child.example', 'PAYMENTS_MODE': 'disabled', 'ASSET_STORE': 'mongo'},
                      'atlas': {'mongoUser': 'child_staging'}, 'google': {'projectId': 'shared-staging'}}
            (root / 'child-staging-database.json').write_text(json.dumps({'database': 'unibase_staging', 'username': 'unibase_staging', 'password': 'synthetic'}))
            (root / 'child-staging-web.json').write_text(json.dumps({'projectId': 'shared-staging', 'appId': 'parent-app', 'apiKey': 'public', 'authDomain': 'unibase.example'}))
            with patch.object(setup, 'load', return_value=config), patch.object(setup.subprocess, 'check_output', return_value=revision):
                _, _, missing, invalid = setup.inspect(root, 'child', revision, root)
            self.assertCountEqual(invalid, ['child-staging-database.json', 'child-staging-web.json'])
            self.assertIn('firebase-staging-service-account.json', missing)

    def test_identity_and_local_settings_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'project.config.json').write_text(json.dumps({'slug': 'child'}))
            with patch.object(setup.subprocess, 'check_output', return_value='a'*40):
                with self.assertRaises(ValueError):
                    setup.inspect(root, 'unibase', 'a'*40, root)

    def test_uncertain_mutation_never_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            journal = setup.mutation_journal(Path(tmp))
            calls = []
            def uncertain():
                calls.append('called')
                raise TimeoutError('provider might have created the resource')
            with self.assertRaises(TimeoutError):
                journal('firebase-web-create', uncertain)
            with self.assertRaises(ValueError):
                journal('firebase-web-create', uncertain)
            self.assertEqual(calls, ['called'])
            self.assertEqual(json.loads((Path(tmp)/'firebase-web-create.json').read_text())['status'], 'uncertain')

    def test_github_upload_uses_only_current_secret_interfaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            (directory/'uniwares-deploy-user').write_text('synthetic-key')
            (directory/'cloudflare-discovery.json').write_text('{"apiToken":"synthetic-token"}')
            host=directory/'host.pub'; host.write_text('host.example ssh-ed25519 public-record')
            config={'deployment':{'imageRepository':'ghcr.io/example/child'},'ssh':{'host':'host.example'}}
            with patch.object(setup.subprocess,'run') as run:
                run.return_value.returncode=0
                setup.github_secrets(config,directory,host)
                self.assertEqual([call.args[0][3] for call in run.call_args_list], ['DEPLOY_SSH_PRIVATE_KEY','DEPLOY_SSH_HOST_KEY','CLOUDFLARE_READ_TOKEN'])
                self.assertTrue(all(call.args[0][-1]=='example/child' for call in run.call_args_list))

    def test_provider_discovery_refuses_privilege_conflict_and_insufficient_access(self):
        bindings=setup.provider_module()
        config={'google':{'projectId':'shared-staging'},'atlas':{'projectId':'a'*24,'mongoUser':'child_staging','clusterName':'shared','vpsEgressCidr':'192.0.2.1/32'},'runtime':{'MONGODB_DATABASE':'child_staging','APP_ORIGIN':'https://child.example'}}
        class API:
            def request(self, provider, method, url, **kwargs):
                if 'webApps' in url: return {'apps':[]}
                if url.endswith('/config'): return {'authorizedDomains':[]}
                return {'roles':[{'roleName':'atlasAdmin','databaseName':'admin'}], 'scopes':[]}
        with self.assertRaisesRegex(ValueError,'privileges'):
            bindings.discover(API(),config,'child')
        with patch.object(API,'request',side_effect=ValueError('google HTTP 403')):
            with self.assertRaisesRegex(ValueError,'403'):
                bindings.discover(API(),config,'child')


if __name__ == '__main__':
    unittest.main()
