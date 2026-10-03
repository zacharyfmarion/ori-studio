"""Build the Diagram's text fonts from the pinned upstream sources.

    python scripts/diagram-fonts/build_fonts.py [--cache DIR] [--out DIR]

Needs the pinned toolchain in requirements.txt (pip install -r
scripts/diagram-fonts/requirements.txt): fonttools, brotli, and skia-pathops,
which removing the variable fonts' overlaps uses. Every source in sources.json
is downloaded (once, into --cache) and checked against its sha256, then:

- **Static instances.** Regular (wght 400) and Bold (wght 700) of each
  variable font, as TrueType, named "Noto Sans …" with the usual name, OS/2
  weight and style bits. Width 100 for Noto Sans.
- **No layout features.** Every output drops GSUB/GPOS lookups and hinting:
  the composer measures plain advances and sets every line itself
  (implementation-plans/diagram-workspace.md, Decision 2), so no renderer may
  kern, ligate or apply `calt` — Noto Sans KR's `calt` widens Hangul lines by
  up to 2.6 pt.
- **Latin bundle** (apps/web/src/diagram/fonts/, committed): Noto Sans Regular
  and Bold cut to charsets/latin.txt.
- **CJK tiers** (--out, default apps/web/public/fonts/diagram/, not committed):
  for SC, TC, JP and KR, Regular and Bold, a `common` file cut to
  charsets/common.txt plus the script's set, and the `full` file. The common
  file is a strict subset of the full one, so glyphs and advances agree. Each
  is named for its content (`NotoSansSC-Bold.full.<sha256:12>.ttf`), so the
  app's service worker may keep a copy for good (`pwa/swRoutes.ts`), and the
  files of an earlier build are cleared from --out first.
- **Reproducible.** fontTools stamps each font's `head.modified` with the
  time it is saved; the build pins it (`BUILD_TIMESTAMP`), so the same sources
  and toolchain always write the same bytes, and the same names. A name then
  changes only with the sources, the toolchain, or (for a common file) a
  charset — which matters, because an installed desktop app reads the full
  files by name from the site (`check_fonts.py` checks the stamp).
- **Manifest** (--out/manifest.json): every CJK file's family, weight, tier,
  bytes and sha256, which the app checks each download against, and each
  script's full coverage (compact code-point runs), so the app fetches a full
  file only for a character it has.
- **Licences.** Each family's OFL.txt from the same commit, beside its fonts
  (OFL-NotoSans.txt with the Latin bundle; OFL-NotoSansSC.txt and the rest
  with the CJK files): the OFL travels with every copy of the fonts.
"""
import argparse
import hashlib
import io
import json
import os
import sys
import urllib.parse
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Every font's head.modified (fontTools reads SOURCE_DATE_EPOCH): 2026-01-01T00:00:00Z.
BUILD_TIMESTAMP = 1767225600
os.environ['SOURCE_DATE_EPOCH'] = str(BUILD_TIMESTAMP)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WEIGHTS = {'Regular': 400, 'Bold': 700}
CJK = {'SC': 'sc.txt', 'TC': 'tc.txt', 'JP': 'jp.txt', 'KR': 'kr.txt'}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def source(cache, sources, family):
    entry = sources['fonts'][family]
    path = os.path.join(cache, os.path.basename(entry['path']))
    if not os.path.exists(path):
        url = 'https://raw.githubusercontent.com/google/fonts/{}/{}'.format(
            sources['commit'], urllib.parse.quote(entry['path'])
        )
        print('downloading', url, flush=True)
        with urllib.request.urlopen(url) as response, open(path, 'wb') as out:
            out.write(response.read())
    data = open(path, 'rb').read()
    if sha256(data) != entry['sha256']:
        sys.exit(f'{path}: sha256 {sha256(data)} is not the pinned {entry["sha256"]}')
    return path


def licence(sources, family, out_dir):
    """The family's OFL.txt at the pinned commit, written beside its fonts."""
    folder = os.path.dirname(sources['fonts'][family]['path'])
    url = 'https://raw.githubusercontent.com/google/fonts/{}/{}/OFL.txt'.format(sources['commit'], folder)
    with urllib.request.urlopen(url) as response:
        text = response.read()
    with open(os.path.join(out_dir, f'OFL-{family}.txt'), 'wb') as out:
        out.write(text)


def instance(path, family, style):
    font = TTFont(path)
    location = {'wght': WEIGHTS[style]}
    if 'wdth' in [axis.axisTag for axis in font['fvar'].axes]:
        location['wdth'] = 100
    font = instancer.instantiateVariableFont(
        font, location, overlap=instancer.OverlapMode.REMOVE, updateFontNames=False, static=True
    )
    name = font['name']
    for record in list(name.names):
        if record.nameID in (16, 17, 21, 22, 25):
            name.removeNames(nameID=record.nameID)
    postscript = family.replace(' ', '') + '-' + style
    for platform, encoding, language in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(family, 1, platform, encoding, language)
        name.setName(style, 2, platform, encoding, language)
        name.setName(f'{family} {style}', 4, platform, encoding, language)
        name.setName(postscript, 6, platform, encoding, language)
    os2 = font['OS/2']
    os2.usWeightClass = WEIGHTS[style]
    if style == 'Bold':
        os2.fsSelection = (os2.fsSelection & ~0x40 & ~0x1) | 0x20
        font['head'].macStyle = 1
    else:
        os2.fsSelection = (os2.fsSelection & ~0x20 & ~0x1) | 0x40
        font['head'].macStyle = 0
    return font


def cut(font, text=None):
    """The font with only `text` (all of it when None), no layout features and no hinting."""
    options = subset.Options()
    options.layout_features = []
    # Empty once their features are gone: drop them, so no reader can find one.
    options.drop_tables += ['GSUB', 'GPOS', 'GDEF']
    options.hinting = False
    options.notdef_outline = True
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.glyph_names = False
    subsetter = subset.Subsetter(options)
    if text is None:
        subsetter.populate(unicodes=font.getBestCmap().keys())
    else:
        cmap = font.getBestCmap()
        subsetter.populate(unicodes=[ord(c) for c in text if ord(c) in cmap])
    subsetter.subset(font)
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def coverage(code_points):
    """A full file's code points, compact: each run as `gap.length` in base 36, comma-separated.

    `gap` is how far the run starts past the previous one's end (from -1), and
    `length` how many code points it holds less one. diagramFonts.ts reads it.
    """
    runs = []
    for code_point in sorted(code_points):
        if runs and runs[-1][1] == code_point - 1:
            runs[-1][1] = code_point
        else:
            runs.append([code_point, code_point])
    parts = []
    previous = -1
    for first, last in runs:
        parts.append(f'{base36(first - previous - 1)}.{base36(last - first)}')
        previous = last
    return ','.join(parts)


def base36(number):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    text = ''
    while True:
        number, digit = divmod(number, 36)
        text = digits[digit] + text
        if number == 0:
            return text


def charset(name):
    with open(os.path.join(HERE, 'charsets', name), encoding='utf-8') as source_file:
        return source_file.read().rstrip('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--cache', default=os.path.join(REPO, 'artifacts', 'diagram-fonts', 'sources'))
    parser.add_argument('--out', default=os.path.join(REPO, 'apps', 'web', 'public', 'fonts', 'diagram'))
    parser.add_argument('--latin-out', default=os.path.join(REPO, 'apps', 'web', 'src', 'diagram', 'fonts'))
    parser.add_argument('--skip-cjk', action='store_true', help='build only the bundled Latin fonts')
    parser.add_argument(
        '--skip-latin', action='store_true', help='build only the CJK files (CI: the Latin bundle is committed)'
    )
    args = parser.parse_args()
    sources = json.load(open(os.path.join(HERE, 'sources.json')))
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.latin_out, exist_ok=True)

    if not args.skip_latin:
        latin = charset('latin.txt')
        path = source(args.cache, sources, 'NotoSans')
        lacking = [c for c in latin if ord(c) not in TTFont(path).getBestCmap()]
        if lacking:
            print(f'note: Noto Sans lacks {len(lacking)} of latin.txt\'s characters (U+{ord(lacking[0]):04X}…)', flush=True)
        licence(sources, 'NotoSans', args.latin_out)
        for style in WEIGHTS:
            data = cut(instance(path, 'Noto Sans', style), latin)
            out = os.path.join(args.latin_out, f'NotoSans-{style}.ttf')
            open(out, 'wb').write(data)
            print(out, len(data), flush=True)
    if args.skip_cjk:
        return

    # An earlier build's files carry other names; none may linger beside this one's.
    for old in os.listdir(args.out):
        if old.startswith('NotoSans') and old.endswith('.ttf'):
            os.remove(os.path.join(args.out, old))

    common = charset('common.txt')
    files = []
    covers = {}
    for script, set_name in CJK.items():
        family = f'Noto Sans {script}'
        path = source(args.cache, sources, f'NotoSans{script}')
        licence(sources, f'NotoSans{script}', args.out)
        for style in WEIGHTS:
            static = instance(path, family, style)
            buffer = io.BytesIO()
            static.save(buffer)
            for tier, text in (('common', common + charset(set_name)), ('full', None)):
                data = cut(TTFont(io.BytesIO(buffer.getvalue())), text)
                name = f'NotoSans{script}-{style}.{tier}.{sha256(data)[:12]}.ttf'
                open(os.path.join(args.out, name), 'wb').write(data)
                font = TTFont(io.BytesIO(data))
                cmap = font.getBestCmap()
                entry = {
                    'file': name,
                    'script': script.lower(),
                    'family': family,
                    'weight': WEIGHTS[style],
                    'tier': tier,
                    'bytes': len(data),
                    'sha256': sha256(data),
                    'codepoints': len(cmap),
                }
                if tier == 'full':
                    # What only the full file has is fetched for; the app asks the
                    # manifest first, so a character no file has never costs a
                    # download. Regular and Bold are cut from one font: one entry.
                    covered = coverage(cmap.keys())
                    if covers.setdefault(script.lower(), covered) != covered:
                        sys.exit(f'{name}: its weights cover different characters')
                files.append(entry)
                print(name, len(data), flush=True)
    manifest = {
        'version': 1,
        'source': {'repository': sources['repository'], 'commit': sources['commit']},
        'files': files,
        'coverage': covers,
    }
    with open(os.path.join(args.out, 'manifest.json'), 'w') as out:
        # Compact: the full files' ranges are thousands of numbers, read once a session.
        json.dump(manifest, out, separators=(',', ':'))
        out.write('\n')


if __name__ == '__main__':
    main()
