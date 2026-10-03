"""Check a built font directory against its own manifest, before it ships.

    python3 scripts/diagram-fonts/check_fonts.py [DIR] [--warn-renames-against URL]

Every file the manifest names must be there, of its size and sha256, named for
its content, and stamped with the build's fixed time (so a rebuild writes the
same bytes and the same names); every script needs Regular and Bold in both
tiers; and each family's licence must travel with it. A cache restored from an interrupted
build, or a half-copied directory, fails here rather than in a reader's
browser. Standard library only, so it runs with no setup.

With --warn-renames-against (the live site's manifest), it also warns, as a
GitHub annotation, when this build no longer has a full file the site serves:
an installed desktop app reads the full files from the site by the names its
own build gave them, and loses the rare characters until it is updated.
"""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import urllib.request

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


def renamed_full_files(manifest, url):
    """The full files the manifest at `url` names that this build does not; None when it cannot be read."""
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            live = json.load(response)
    except (OSError, ValueError):
        return None
    if not isinstance(live, dict) or not isinstance(live.get('files'), list):
        return None
    ours = {entry.get('file') for entry in manifest.get('files', []) if entry.get('tier') == 'full'}
    theirs = {entry.get('file') for entry in live['files'] if isinstance(entry, dict) and entry.get('tier') == 'full'}
    return sorted(name for name in theirs - ours if isinstance(name, str))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('folder', nargs='?', default=os.path.join(REPO, 'apps', 'web', 'public', 'fonts', 'diagram'))
    parser.add_argument('--warn-renames-against', metavar='URL')
    args = parser.parse_args()
    folder = args.folder
    problems = []
    try:
        manifest = json.load(open(os.path.join(folder, 'manifest.json'), encoding='utf-8'))
    except (OSError, ValueError) as error:
        sys.exit(f'{folder}: no manifest that reads ({error})')
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
    if args.warn_renames_against:
        gone = renamed_full_files(manifest, args.warn_renames_against)
        if gone is None:
            print(f'{args.warn_renames_against}: no manifest to compare with')
        elif gone:
            print(
                '::warning title=Diagram fonts renamed::This build drops full CJK files the site serves '
                f'({", ".join(gone)}). Installed desktop apps read them by those names, and lose the rare '
                'characters until they are updated. Ship a desktop release soon after this deploy.'
            )


if __name__ == '__main__':
    main()
