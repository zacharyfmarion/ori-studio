"""Check a built font directory against its own manifest, before it ships.

    python3 scripts/diagram-fonts/check_fonts.py [DIR]

Every file the manifest names must be there, of its size and sha256, named for
its content, and stamped with the build's fixed time (so a rebuild writes the
same bytes and the same names); every script needs Regular and Bold in both
tiers; and each family's licence must travel with it. A cache restored from an interrupted
build, or a half-copied directory, fails here rather than in a reader's
browser. Standard library only, so it runs with no setup.

v1-lock.json freezes the launch font set, including the bundled Latin fonts,
coverage metadata, source pins and toolchain. Every build must retain those
exact files: a rename or change fails before deployment, even when the live
site cannot be reached. A new font set needs a new id and must keep v1 served.
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAME = re.compile(r'^NotoSans(SC|TC|JP|KR)-(Regular|Bold)\.(common|full)\.([0-9a-f]{12})\.ttf$')
# build_fonts.py's BUILD_TIMESTAMP, as `head.modified` counts it: seconds since 1904.
BUILD_TIMESTAMP = 1767225600
MAC_EPOCH_OFFSET = 2082844800


def head_modified(data):
    """The font's head.modified, read from its table directory; None if it has no head."""
    (count,) = struct.unpack_from('>H', data, 4)
    for index in range(count):
        tag, _, offset, _ = struct.unpack_from('>4sIII', data, 12 + 16 * index)
        if tag == b'head':
            (modified,) = struct.unpack_from('>q', data, offset + 28)
            return modified
    return None


def v1_problems(manifest, lock, repo=REPO):
    """The implicit v1 font set is file format: never replace its files or metrics."""
    problems = []
    files = {entry.get('file'): entry for entry in manifest.get('files', [])}
    for expected in lock['fonts']:
        actual = files.get(expected['file'])
        if actual is None or any(actual.get(key) != value for key, value in expected.items()):
            problems.append(f"{expected['file']}: frozen v1 font removed, renamed or changed")
    encoded = json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()
    if hashlib.sha256(encoded).hexdigest() != lock['manifestSha256']:
        problems.append('manifest: frozen v1 font set or coverage changed; a new font set needs its own id')
    for relative, expected in lock['inputs'].items():
        try:
            with open(os.path.join(repo, relative), 'rb') as source:
                actual = hashlib.sha256(source.read()).hexdigest()
        except OSError:
            actual = None
        if actual != expected:
            problems.append(f'{relative}: frozen v1 input changed or missing')
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('folder', nargs='?', default=os.path.join(REPO, 'apps', 'web', 'public', 'fonts', 'diagram'))
    args = parser.parse_args()
    folder = args.folder
    problems = []
    try:
        manifest = json.load(open(os.path.join(folder, 'manifest.json'), encoding='utf-8'))
    except (OSError, ValueError) as error:
        sys.exit(f'{folder}: no manifest that reads ({error})')
    with open(os.path.join(REPO, 'scripts', 'diagram-fonts', 'v1-lock.json'), encoding='utf-8') as source:
        lock = json.load(source)
    problems.extend(v1_problems(manifest, lock))
    seen = set()
    for entry in manifest.get('files', []):
        name = entry.get('file', '')
        match = NAME.match(name)
        if not match:
            problems.append(f'{name}: not a CJK font name with its hash')
            continue
        path = os.path.join(folder, name)
        if not os.path.exists(path):
            problems.append(f'{name}: missing')
            continue
        data = open(path, 'rb').read()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != entry.get('bytes') or digest != entry.get('sha256'):
            problems.append(f'{name}: not the file the manifest names')
        if not digest.startswith(match.group(4)):
            problems.append(f'{name}: not named for its content')
        if head_modified(data) != BUILD_TIMESTAMP + MAC_EPOCH_OFFSET:
            problems.append(f'{name}: not stamped with the build\'s fixed time, so a rebuild renames it')
        seen.add((match.group(1), match.group(2), match.group(3)))
    for script in ('SC', 'TC', 'JP', 'KR'):
        for style in ('Regular', 'Bold'):
            for tier in ('common', 'full'):
                if (script, style, tier) not in seen:
                    problems.append(f'NotoSans{script}-{style}.{tier}: not in the manifest')
        if not os.path.exists(os.path.join(folder, f'OFL-NotoSans{script}.txt')):
            problems.append(f'OFL-NotoSans{script}.txt: the licence is missing')
    if problems:
        sys.exit('\n'.join(problems))
    print(f'{folder}: {len(manifest["files"])} files, each as the manifest names it')


if __name__ == '__main__':
    main()
