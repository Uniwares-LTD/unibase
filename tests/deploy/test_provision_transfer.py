"""Execute the real SSH transfer with synthetic credentials and local transport."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get("UNIBASE_DEPLOY_TEST_CONTAINER") == "1", "Requires owned Linux test container")
class ProvisionTransferTests(unittest.TestCase):
    def test_provider_credentials_stay_outside_administration_source_and_are_cleaned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, mock, runner = root / "checkout", root / "bin", root / "runner"
            for path in (source, mock, runner):
                path.mkdir()
            files = {
                "project.config.json": json.dumps({"slug": "unibase"}),
                "package.json": "{}", "package-lock.json": "{}", "tsconfig.json": "{}",
                "src/placeholder.txt": "public source", "messages/placeholder.txt": "public messages",
                "deploy/config.json": "excluded private configuration",
                "scripts/deploy/provision.py": '''import argparse,json
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('environment'); p.add_argument('--credentials'); p.add_argument('--admin-uid-file'); p.add_argument('--apply',action='store_true'); args=p.parse_args()
source=Path(__file__).resolve().parents[2]
credential=Path(args.credentials).resolve()
assert not credential.is_relative_to(source)
values=json.loads(credential.read_text())
assert not (source/'deploy/config.json').exists()
for file in source.rglob('*'):
    if file.is_file():
        text=file.read_text()
        assert all(value not in text for value in values.values() if value)
print('verified: provider administration credentials excluded from source')
''',
            }
            for name, content in files.items():
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            for name, content in {
                "git": '#!/usr/bin/env python3\nimport sys\nsys.stdout.write(' + repr("\0".join(files) + "\0") + ')\n',
                "ssh": '#!/usr/bin/env bash\nbash -c "${!#}"\n',
                "scp": '#!/usr/bin/env bash\ncp -- "$3" "${4#unibase-vps:}"\n',
                "sudo": '#!/usr/bin/env bash\n[[ ${1:-} != -n ]] || shift\nexec "$@"\n',
            }.items():
                path = mock / name
                path.write_text(content)
                path.chmod(0o755)
            env = dict(os.environ, PATH=str(mock) + ":" + os.environ["PATH"], RUNNER_TEMP=str(runner), GITHUB_REF="refs/heads/main")
            for key in ("GOOGLE_ACCESS_TOKEN", "ATLAS_CLIENT_ID", "ATLAS_CLIENT_SECRET", "GHCR_PULL_TOKEN"):
                env[key] = "synthetic-transfer-" + key.lower()
            result = subprocess.run(["bash", str(REPO / "scripts/deploy/provision.sh"), "production", "preview"], cwd=source,
                                    env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("credentials excluded", result.stdout)
            for key in ("GOOGLE_ACCESS_TOKEN", "ATLAS_CLIENT_ID", "ATLAS_CLIENT_SECRET", "GHCR_PULL_TOKEN"):
                self.assertNotIn(env[key], result.stdout + result.stderr)
            self.assertFalse(list(runner.glob("*credentials*.json")))
