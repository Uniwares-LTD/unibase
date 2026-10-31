"""Resume the exact published candidate of this Actions run; never rebuild it silently."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def validate(candidate,commit,repository):
    if set(candidate)!={'sourceCommit','image'} or candidate['sourceCommit']!=commit:
        raise ValueError('CANDIDATE_SOURCE_CHANGED')
    if not re.fullmatch(re.escape('ghcr.io/'+repository.lower())+r'@sha256:[a-f0-9]{64}',candidate['image']):
        raise ValueError('INVALID_CANDIDATE_IMAGE')
    return candidate


def restore(destination):
    repo=os.environ['GITHUB_REPOSITORY'];commit=os.environ['GITHUB_SHA'];run=os.environ['GITHUB_RUN_ID']
    records=json.loads(subprocess.check_output(['gh','api','repos/'+repo+'/actions/runs/'+run+'/artifacts','--paginate','--slurp']))
    matches=[item for page in records for item in page['artifacts'] if item['name']=='release-candidate-'+commit and not item['expired']]
    if len(matches)>1:raise ValueError('AMBIGUOUS_CANDIDATE')
    if not matches:
        if int(os.environ.get('GITHUB_RUN_ATTEMPT','1'))>1:
            raise ValueError('PRIOR_CANDIDATE_UNAVAILABLE_START_NEW_REVIEWED_RUN')
        return
    raw=subprocess.check_output(['gh','api','repos/'+repo+'/actions/artifacts/'+str(matches[0]['id'])+'/zip'])
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if archive.namelist()!=['release-candidate.json'] or archive.getinfo('release-candidate.json').file_size>1024:
            raise ValueError('INVALID_CANDIDATE_ARTIFACT')
        candidate=validate(json.loads(archive.read('release-candidate.json')),commit,repo)
    destination.write_text(json.dumps(candidate)+'\n',encoding='utf-8')
    if os.environ.get('GITHUB_ENV'):
        with open(os.environ['GITHUB_ENV'],'a',encoding='utf-8') as output:output.write('CANDIDATE_RESTORED=true\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('path',type=Path);args=parser.parse_args()
    try:restore(args.path)
    except Exception:raise SystemExit('Candidate resume stopped; inspect retained artifact and registry digest before another publication.') from None
