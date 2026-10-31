"""Build an immutable projected control archive without executing candidate code."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
from deployment_contract import load, project


def build(checkout, revision, output):
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise ValueError('Full immutable reviewed commit required')
    output = Path(output)
    manifest_path = output.with_suffix(output.suffix + '.manifest.json')
    if output.exists() or manifest_path.exists():
        raise ValueError('Output exists; preserve reviewed bundles')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(checkout), *args])
    if git('rev-parse', '--verify', revision+'^{commit}').decode().strip() != revision:
        raise ValueError('Commit identity mismatch')
    with tempfile.TemporaryDirectory() as temp:
        contract_path = Path(temp)/'contract.json'
        try:
            contract_path.write_bytes(git('show', revision+':deploy/contract.json'))
        except subprocess.CalledProcessError:
            raise ValueError('Source lacks deploy/contract.json; adopt a supported contract first') from None
        contract = load(contract_path)
    raw = git('archive', '--format=tar', revision, 'package.json', 'package-lock.json',
              'project.config.json', 'tsconfig.json', 'src', 'scripts', 'deploy', 'messages')
    hashes = {}
    content = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(raw)) as source, tarfile.open(fileobj=content, mode='w') as target:
        for item in source:
            path = PurePosixPath(item.name)
            if item.name == 'deploy/bundle-source.json':
                raise ValueError('Reserved generated bundle manifest path')
            if not (item.isdir() or item.isfile()) or path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe bundle member')
            hidden = any(part.startswith('.') and not (part == '.well-known' and path.parts[:3] == ('src','app','.well-known')) for part in path.parts)
            if hidden or path.suffix in ('.pem','.key','.env') or 'secrets' in path.parts or path.as_posix() == 'deploy/config.json' or (path.suffix == '.json' and ('credentials' in path.name or 'service-account' in path.name)):
                raise ValueError('Private bundle member forbidden')
            data = source.extractfile(item).read() if item.isfile() else b''
            if path.parent.as_posix() == 'deploy/environments' and path.suffix == '.json':
                config = project(json.loads(data), contract)
                hashes[path.stem] = hashlib.sha256(json.dumps(config,sort_keys=True,separators=(',',':')).encode()).hexdigest()
                data = (json.dumps(config,indent=2)+'\n').encode()
            item.size = len(data)
            target.addfile(item, io.BytesIO(data) if item.isfile() else None)
        metadata=(json.dumps({'sourceCommit':revision,'contractVersion':contract['version']},sort_keys=True)+'\n').encode()
        member=tarfile.TarInfo('deploy/bundle-source.json');member.size=len(metadata);member.mode=0o600
        target.addfile(member,io.BytesIO(metadata))
    archive = content.getvalue()
    manifest = dict(version=1, sourceCommit=revision, contractVersion=contract['version'],
                    configurationHashes=hashes, bundleChecksum=hashlib.sha256(archive).hexdigest(),
                    requiredCapabilities=contract['requiredCapabilities'])
    with output.open('xb') as stream: stream.write(archive)
    with manifest_path.open('x', encoding='utf-8') as stream: json.dump(manifest,stream,indent=2); stream.write('\n')
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout',type=Path)
    parser.add_argument('revision')
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    print(json.dumps(build(args.checkout,args.revision,args.output),sort_keys=True))

if __name__ == '__main__': main()
