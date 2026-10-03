"""Check a built font directory against its own manifest, before it ships.

    python3 scripts/diagram-fonts/check_fonts.py [DIR]

Every file the manifest names must be there, of its size and sha256, and named
for its content; every script needs Regular and Bold in both tiers; and each
family's licence must travel with it. A cache restored from an interrupted
build, or a half-copied directory, fails here rather than in a reader's
browser. Standard library only, so it runs with no setup.
"""
import hashlib
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAME = re.compile(r'^NotoSans(SC|TC|JP|KR)-(Regular|Bold)\.(common|full)\.([0-9a-f]{12})\.ttf$')


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, 'apps', 'web', 'public', 'fonts', 'diagram')
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
