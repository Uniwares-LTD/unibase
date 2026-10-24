"""Require public GHCR; first publication may require a one-time owner visibility change."""
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def verify(stage, repository, token, opener=urlopen):
    owner, package = repository.lower().split('/')
    def request(path):
        return json.load(opener(Request('https://api.github.com/' + path, headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'}), timeout=20))
    kind = 'orgs' if request('users/' + owner)['type'] == 'Organization' else 'users'
    try:
        value = request(f'{kind}/{owner}/packages/container/{package}')
    except HTTPError as error:
        if error.code == 404 and stage == 'before':
            return
        raise
    if value['visibility'] != 'public':
        raise ValueError('Set the GHCR package visibility to public in its owner settings, then rerun Release; no host deployment occurred')


if __name__ == '__main__':
    try:
        verify(sys.argv[1], os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN'])
    except ValueError as error:
        sys.exit(str(error))
    except Exception:
        sys.exit('Unable to verify public package visibility (details suppressed)')
