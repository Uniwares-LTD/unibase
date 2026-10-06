"""Read the independent advisory artifact when available; never gate a release."""
import io
import json
import os
import subprocess
import zipfile


def api(endpoint, binary=False):
    result = subprocess.run(["gh", "api", endpoint], capture_output=True, timeout=20, check=True)
    return result.stdout if binary else json.loads(result.stdout)


def summary(results):
    if not results:
        return "Built successfully; advisory quality results are pending or unavailable."
    if any(item.get("exitCode") != 0 for item in results):
        return "Built successfully with quality warnings. Inspect the independent advisory artifact."
    return "Built successfully; all reported advisory checks passed."


if __name__ == "__main__":
    results = None
    try:
        repo = os.environ["GITHUB_REPOSITORY"]
        commit = os.environ["GITHUB_SHA"]
        runs = api(f"repos/{repo}/actions/workflows/validate.yml/runs?per_page=30")["workflow_runs"]
        run = next(item for item in runs if item["head_sha"] == commit and item["status"] == "completed")
        artifacts = api(f"repos/{repo}/actions/runs/{run['id']}/artifacts")["artifacts"]
        artifact = next(item for item in artifacts if item["name"] == f"quality-{commit}" and not item["expired"])
        data = api(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", binary=True)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            results = json.loads(archive.read("results.json"))
    except Exception:
        pass
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as report:
        report.write(summary(results) + "\n")
