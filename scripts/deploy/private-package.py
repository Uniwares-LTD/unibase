"""Fail closed for public GHCR packages; only a confirmed 404 permits first push."""
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError

owner, package = os.environ["GITHUB_REPOSITORY"].lower().split("/")
token = os.environ["GH_TOKEN"]


def request(path):
    return json.load(urlopen(Request("https://api.github.com/" + path, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }), timeout=20))


try:
    kind = "orgs" if request("users/" + owner)["type"] == "Organization" else "users"
    try:
        result = request(f"{kind}/{owner}/packages/container/{package}")
    except HTTPError as error:
        if error.code == 404 and sys.argv[1] == "before":
            sys.exit(0)
        raise
    if result["visibility"] != "private":
        sys.exit("GHCR package must be private; visibility was not changed")
except Exception:
    sys.exit("Unable to verify private GHCR package (details suppressed)")
