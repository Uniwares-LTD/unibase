import importlib.util
import json
import base64
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[2] / "scripts/deploy/config.py"
spec = importlib.util.spec_from_file_location("deployment_config", MODULE)
config_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config_module)

def tunnel_token(tunnel_id, secret="synthetic-secret"):
    return base64.b64encode(json.dumps({"a": "synthetic-account", "t": tunnel_id, "s": base64.b64encode(secret.encode()).decode()}).encode()).decode()


def fixture(root):
    config = {"imageRepository": "ghcr.io/test/unitale"}
    for target, port in (("staging", 3100), ("production", 3102)):
        item = {"origin": f"https://{target}.example.test", "port": port,
                "firebaseProject": f"unitale-{target}-test", "mongoDatabase": f"unitale_{target}",
                "mongoUser": f"unitale_{target}", "tunnelImage": "cloudflare/cloudflared@sha256:" + "a" * 64}
        item["tunnelId"] = "11111111-1111-4111-8111-111111111111" if target == "staging" else "22222222-2222-4222-8222-222222222222"
        config[target] = item
        directory = root / target
        directory.mkdir(parents=True, exist_ok=True)
        env = {"APP_ENV": target, "APP_ORIGIN": item["origin"], "AUTH_MODE": "firebase",
               "FIREBASE_PROJECT_ID": item["firebaseProject"], "FIREBASE_API_KEY": "test-public-key",
               "FIREBASE_APP_ID": "test-public-app", "MONGODB_DATABASE": item["mongoDatabase"],
               "MONGODB_URI": f"mongodb+srv://{item['mongoUser']}:test-password@example.test"}
        (directory / "runtime.env").write_text("".join(f"{key}={value}\n" for key, value in env.items()))
        (directory / "firebase.json").write_text(json.dumps({"type": "service_account", "project_id": item["firebaseProject"], "private_key": "synthetic-fixture"}))
        (directory / "tunnel-token").write_text(tunnel_token(item["tunnelId"]))
    (root / "config.json").write_text(json.dumps(config))
    return config


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="unitale-deploy-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = fixture(self.root)

    def test_valid_isolated_inputs(self):
        for target in ("staging", "production"):
            values = config_module.validate(self.root, target)
            self.assertEqual(values[0], self.config[target]["origin"])
            self.assertNotIn("test-password", "".join(values))

    def test_dify_bindings_are_private_and_validated(self):
        env = self.root / "staging/runtime.env"
        original = env.read_text()
        bindings = [{"name": "assistant-text", "revision": "1", "kind": "workflow", "apiKeyEnv": "DIFY_KEY_TEXT"}]
        extra = "DIFY_MODE=live\nDIFY_BASE_URL=https://dify.example.test/v1\nDIFY_BINDINGS_JSON=" + json.dumps(bindings) + "\nDIFY_KEY_TEXT=synthetic-private-key\n"
        env.write_text(original + extra)
        self.assertNotIn("synthetic-private-key", "".join(config_module.validate(self.root, "staging")))
        for bad in (extra.replace("https://", "http://"), extra.replace("DIFY_KEY_TEXT=synthetic-private-key\n", ""), extra.replace("DIFY_MODE=live", "DIFY_MODE=invalid")):
            env.write_text(original + bad)
            with self.assertRaises(ValueError):
                config_module.validate(self.root, "staging")

    def test_ai_pricing_environment_is_allowed_and_bounded(self):
        env = self.root / "staging/runtime.env"
        original = env.read_text()
        env.write_text(original + 'AI_PRICING_JSON={"assistant-text":{"mode":"fixed","credits":2}}\n')
        config_module.validate(self.root, "staging")
        for value in ('[]', 'broken', '{"x":"' + 'a' * 65536 + '"}'):
            env.write_text(original + 'AI_PRICING_JSON=' + value + '\n')
            with self.assertRaises(ValueError):
                config_module.validate(self.root, "staging")

    def test_each_shared_identity_is_rejected(self):
        for field in ("origin", "port", "firebaseProject", "mongoDatabase", "mongoUser", "tunnelId"):
            with self.subTest(field=field):
                config = json.loads(json.dumps(self.config))
                config["staging"][field] = config["production"][field]
                (self.root / "config.json").write_text(json.dumps(config))
                with self.assertRaises(ValueError):
                    config_module.validate(self.root, "staging")

    def test_staging_cannot_use_production_runtime_or_credential(self):
        for filename in ("runtime.env", "firebase.json"):
            with self.subTest(filename=filename):
                fixture(self.root)
                (self.root / "staging" / filename).write_bytes((self.root / "production" / filename).read_bytes())
                with self.assertRaises(ValueError):
                    config_module.validate(self.root, "staging")

    def test_unknown_emulator_or_shell_code_setting_rejected(self):
        for extra in ("FIREBASE_AUTH_EMULATOR_HOST=localhost:9099", "PATH=/tmp/unsafe", "APP_ENV=production"):
            with self.subTest(extra=extra):
                fixture(self.root)
                with (self.root / "staging/runtime.env").open("a") as file:
                    file.write(extra + "\n")
                with self.assertRaises(ValueError):
                    config_module.validate(self.root, "staging")

    def test_atlas_user_must_match_selected_environment(self):
        env = self.root / "staging/runtime.env"
        env.write_text(env.read_text().replace("mongodb+srv://unitale_staging:", "mongodb+srv://unitale_production:"))
        with self.assertRaises(ValueError):
            config_module.validate(self.root, "staging")

    def test_production_tunnel_token_cannot_be_used_for_staging(self):
        (self.root / "staging/tunnel-token").write_bytes((self.root / "production/tunnel-token").read_bytes())
        with self.assertRaises(ValueError):
            config_module.validate(self.root, "staging")
