#!/usr/bin/env python3
"""Synthetic structured negatives for the crease-pattern likelihood gate.

The scraped corpus has no graph paper, cutting mats, tables, charts, floor
plans, flowcharts, text pages, brick or plaid, mazes or random line art — and
every model trained without them lets most of them through, because to a
line-and-lattice feature set a grid looks a lot like a crease pattern. This
draws a few hundred randomised ones with Pillow and writes a manifest beside
them. Precrease grids (0/90, some with 45s) are emitted as ``amb``: a grid *is*
a crease pattern, and they are reported but never trained on.

Deterministic for a given ``--seed``.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import random

from PIL import Image, ImageDraw, ImageFont


def font(size: int) -> ImageFont.ImageFont:
    for f in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def rc() -> tuple[int, int, int]:
    return tuple(random.randint(0, 255) for _ in range(3))


def paper():
    return random.choice(['white', (250, 248, 240), (235, 235, 235), (30, 30, 30), (40, 110, 60), (210, 225, 240)])


def ink_for(bg) -> object:
    dark = isinstance(bg, tuple) and sum(bg[:3]) / 3 < 128
    if dark:
        return random.choice([(230, 230, 230), (200, 220, 200), 'white'])
    return random.choice(['black', (60, 60, 60), (120, 160, 220), (90, 90, 90), (200, 60, 60)])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out-dir', required=True, help='directory to write the PNGs into')
    parser.add_argument('--manifest', required=True, help='manifest JSONL to write')
    parser.add_argument('--seed', type=int, default=11)
    parser.add_argument('--scale', type=float, default=1.0, help='multiply every per-kind count by this')
    args = parser.parse_args()
    random.seed(args.seed)
    os.makedirs(args.out_dir, exist_ok=True)
    rows: list[dict] = []

    def emit(kind: str, name: str, im: Image.Image, label: str = 'neg') -> None:
        path = os.path.join(args.out_dir, f'{name}.png')
        im.save(path)
        rows.append({'label': label, 'group': f'synth_{kind}', 'path': os.path.abspath(path)})

    def count(n: int) -> int:
        return max(1, int(round(n * args.scale)))

    for i in range(count(30)):  # graph paper / grids / mats
        W = random.randint(500, 1400); bg = paper(); im = Image.new('RGB', (W, W), bg); d = ImageDraw.Draw(im)
        step = random.randint(8, 80); major = random.choice([0, 0, 4, 5, 10]); col = ink_for(bg)
        for k, x in enumerate(range(0, W, step)):
            wd = 2 if major and k % major == 0 else 1
            d.line([(x, 0), (x, W)], fill=col, width=wd); d.line([(0, x), (W, x)], fill=col, width=wd)
        if random.random() < 0.4:
            d.line([(0, 0), (W, W)], fill=col, width=2); d.line([(0, W), (W, 0)], fill=col, width=2)
        if random.random() < 0.3:
            f = font(14)
            for k, x in enumerate(range(0, W, step * max(major, 2))):
                d.text((x + 2, 2), str(k), fill=col, font=f); d.text((2, x + 2), str(k), fill=col, font=f)
        if random.random() < 0.3:
            im = im.rotate(random.uniform(-30, 30), expand=False, fillcolor=bg)
        emit('grid', f'grid_{i}', im)

    for i in range(count(20)):  # tables
        W = random.randint(600, 1400); H = int(W * random.uniform(0.5, 1.3))
        im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im); f = font(random.randint(11, 18))
        ncol = random.randint(3, 9); cols = [0] + sorted(random.sample(range(40, W - 40), ncol - 1)) + [W]
        rh = random.randint(18, 40)
        for y in range(0, H, rh):
            d.line([(0, y), (W, y)], fill=(200, 200, 200))
            for j in range(len(cols) - 1):
                d.text((cols[j] + 4, y + 3), random.choice(['Item', '12.50', '2026-09-14', 'Widget', '3', 'OK', 'Q3', '-', 'total', 'name']),
                       fill=(30, 30, 30), font=f)
        for x in cols:
            d.line([(x, 0), (x, H)], fill=(200, 200, 200))
        emit('table', f'table_{i}', im)

    for i in range(count(20)):  # charts
        W = random.randint(600, 1400); H = int(W * random.uniform(0.5, 0.9))
        im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im)
        x0, y0, x1, y1 = 80, 40, W - 40, H - 60
        for k in range(random.randint(4, 10)):
            y = y0 + (y1 - y0) * k / 9; d.line([(x0, y), (x1, y)], fill=(225, 225, 225))
        d.line([(x0, y0), (x0, y1)], fill='black', width=2); d.line([(x0, y1), (x1, y1)], fill='black', width=2)
        kind = random.choice(['line', 'bar', 'scatter'])
        if kind == 'line':
            for _ in range(random.randint(1, 4)):
                pts = [(x0 + (x1 - x0) * k / 24, y1 - (y1 - y0) * random.random()) for k in range(25)]
                d.line(pts, fill=rc(), width=3)
        elif kind == 'bar':
            n = random.randint(5, 20); bw = (x1 - x0) / n
            for k in range(n):
                h = (y1 - y0) * random.random()
                d.rectangle([x0 + k * bw + 4, y1 - h, x0 + (k + 1) * bw - 4, y1], fill=rc())
        else:
            for _ in range(random.randint(30, 200)):
                x = random.uniform(x0, x1); y = random.uniform(y0, y1); d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=rc())
        emit('chart', f'chart_{i}', im)

    for i in range(count(20)):  # floor plans
        W = random.randint(600, 1400); im = Image.new('RGB', (W, W), 'white'); d = ImageDraw.Draw(im); wd = random.randint(3, 8)
        d.rectangle([60, 60, W - 60, W - 60], outline='black', width=wd)
        for _ in range(random.randint(4, 12)):
            x = random.randint(100, W - 100); y = random.randint(100, W - 100)
            if random.random() < 0.5:
                d.line([(x, random.choice([60, random.randint(60, W - 60)])), (x, random.randint(200, W - 60))], fill='black', width=wd)
            else:
                d.line([(random.choice([60, random.randint(60, W - 60)]), y), (random.randint(200, W - 60), y)], fill='black', width=wd)
        for _ in range(random.randint(3, 9)):
            x = random.randint(100, W - 160); y = random.randint(100, W - 160); r = random.randint(40, 90)
            d.arc([x, y, x + r, y + r], 0, 90, fill='black', width=2); d.line([(x, y + r / 2), (x, y + r)], fill='black', width=2)
        for _ in range(random.randint(2, 8)):
            x = random.randint(100, W - 200); y = random.randint(100, W - 200)
            d.rectangle([x, y, x + random.randint(40, 120), y + random.randint(30, 90)], outline='black', width=2)
        emit('floor_plan', f'floor_{i}', im)

    for i in range(count(20)):  # box-and-arrow diagrams
        W = random.randint(600, 1400); H = int(W * random.uniform(0.6, 1.2))
        im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im); f = font(random.randint(14, 22))
        boxes = []
        for k in range(random.randint(4, 14)):
            bw = random.randint(120, 260); bh = random.randint(50, 100)
            x = random.randint(20, W - bw - 20); y = random.randint(20, H - bh - 20); boxes.append((x, y, x + bw, y + bh))
            d.rounded_rectangle(boxes[-1], radius=random.randint(0, 12), outline=(50, 50, 50), width=2,
                                fill=random.choice([(245, 245, 255), 'white', (255, 245, 230)]))
            d.text((x + 10, y + bh // 2 - 8), random.choice(['Service', 'Queue', 'DB', 'API', 'Worker', 'Cache']) + f' {k}', fill='black', font=f)
        for k in range(len(boxes)):
            a = boxes[k]; b = random.choice(boxes)
            d.line([((a[0] + a[2]) / 2, a[3]), ((b[0] + b[2]) / 2, b[1])], fill=(60, 60, 60), width=2)
        emit('diagram', f'diagram_{i}', im)

    for i in range(count(15)):  # text pages
        W = random.randint(600, 1200); H = int(W * random.uniform(1.0, 1.4))
        im = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(im); f = font(random.randint(12, 22))
        words = 'origami crease pattern design tool folding paper flap river hinge axial ridge gusset molecule tree packing circle base sink petal squash'.split()
        y = 50
        while y < H - 50:
            d.text((60, y), ' '.join(random.choice(words) for _ in range(random.randint(6, 14))), fill=(20, 20, 20), font=f)
            y += int(f.size * 1.6)
        emit('text', f'text_{i}', im)

    for i in range(count(25)):  # periodic patterns
        W = random.randint(500, 1200); kind = random.choice(['brick', 'plaid', 'blinds', 'checker', 'tiles', 'herringbone'])
        if kind == 'brick':
            im = Image.new('RGB', (W, W), (170, 70, 50)); d = ImageDraw.Draw(im); bh = random.randint(25, 60); bw = bh * 3
            for r, y in enumerate(range(0, W, bh)):
                off = bw // 2 if r % 2 else 0; d.line([(0, y), (W, y)], fill=(220, 215, 205), width=5)
                for x in range(off, W, bw):
                    d.line([(x, y), (x, y + bh)], fill=(220, 215, 205), width=5)
        elif kind == 'plaid':
            im = Image.new('RGB', (W, W), rc()); d = ImageDraw.Draw(im); s = random.randint(40, 120); c1 = rc(); c2 = rc()
            for x in range(0, W, s):
                d.line([(x, 0), (x, W)], fill=c1, width=s // 4); d.line([(0, x), (W, x)], fill=c1, width=s // 4)
                d.line([(x + s // 2, 0), (x + s // 2, W)], fill=c2, width=3); d.line([(0, x + s // 2), (W, x + s // 2)], fill=c2, width=3)
        elif kind == 'blinds':
            im = Image.new('RGB', (W, W), (245, 245, 240)); d = ImageDraw.Draw(im); s = random.randint(12, 40)
            for y in range(0, W, s):
                d.rectangle([0, y, W, y + s * 0.6], fill=(200, 200, 195))
            if random.random() < 0.5:
                im = im.rotate(90)
        elif kind == 'checker':
            im = Image.new('RGB', (W, W), 'white'); d = ImageDraw.Draw(im); n = random.randint(4, 16); c = W // n
            for a in range(n):
                for b in range(n):
                    if (a + b) % 2 == 0:
                        d.rectangle([a * c, b * c, (a + 1) * c, (b + 1) * c], fill=(30, 30, 30))
        elif kind == 'tiles':
            im = Image.new('RGB', (W, W), (230, 230, 225)); d = ImageDraw.Draw(im); c = random.randint(40, 120)
            for x in range(0, W, c):
                d.line([(x, 0), (x, W)], fill=(120, 120, 120), width=4); d.line([(0, x), (W, x)], fill=(120, 120, 120), width=4)
            im = im.rotate(45, fillcolor=(230, 230, 225))
        else:
            im = Image.new('RGB', (W, W), (200, 170, 120)); d = ImageDraw.Draw(im); s = random.randint(30, 80)
            for x in range(-W, 2 * W, s):
                d.line([(x, 0), (x + W, W)], fill=(120, 90, 60), width=3); d.line([(x, W), (x + W, 0)], fill=(120, 90, 60), width=3)
        emit('pattern', f'pattern_{kind}_{i}', im)

    for i in range(count(20)):  # random straight-line art
        W = random.randint(500, 1200); bg = paper(); im = Image.new('RGB', (W, W), bg); d = ImageDraw.Draw(im); col = ink_for(bg)
        for _ in range(random.randint(10, 200)):
            d.line([(random.randint(0, W), random.randint(0, W)), (random.randint(0, W), random.randint(0, W))], fill=col, width=random.randint(1, 3))
        emit('random_lines', f'random_lines_{i}', im)

    for i in range(count(15)):  # mazes, QR codes, circuit-ish
        W = random.randint(500, 1000); kind = random.choice(['maze', 'qr', 'circuit'])
        im = Image.new('RGB', (W, W), 'white'); d = ImageDraw.Draw(im)
        if kind == 'maze':
            c = random.randint(15, 45)
            for a in range(0, W, c):
                for b in range(0, W, c):
                    if random.random() < 0.5:
                        d.line([(a, b), (a + c, b)], fill='black', width=3)
                    if random.random() < 0.5:
                        d.line([(a, b), (a, b + c)], fill='black', width=3)
        elif kind == 'qr':
            n = random.randint(21, 57); c = W // n
            for a in range(n):
                for b in range(n):
                    if random.random() < 0.5:
                        d.rectangle([a * c, b * c, (a + 1) * c, (b + 1) * c], fill='black')
        else:
            for _ in range(random.randint(20, 80)):
                x = random.randint(20, W - 20); y = random.randint(20, W - 20); L = random.randint(30, 300)
                if random.random() < 0.5:
                    d.line([(x, y), (x + L, y)], fill=(20, 20, 120), width=2)
                else:
                    d.line([(x, y), (x, y + L)], fill=(20, 20, 120), width=2)
                d.rectangle([x - 6, y - 6, x + 6, y + 6], outline='black', width=2)
        emit('maze_qr', f'{kind}_{i}', im)

    for i in range(count(6)):  # precrease grids: ambiguous by design
        W = 1000; im = Image.new('RGB', (W, W), 'white'); d = ImageDraw.Draw(im); n = random.choice([8, 16, 24, 32]); c = W / n
        for k in range(n + 1):
            d.line([(k * c, 0), (k * c, W)], fill=(120, 120, 120), width=1); d.line([(0, k * c), (W, k * c)], fill=(120, 120, 120), width=1)
        if i % 2:
            for k in range(-n, n + 1, 2):
                d.line([(k * c, 0), (k * c + W, W)], fill=(160, 160, 160), width=1)
        emit('precrease_grid', f'precrease_{i}', im, label='amb')

    os.makedirs(os.path.dirname(os.path.abspath(args.manifest)) or '.', exist_ok=True)
    with open(args.manifest, 'w') as out:
        for row in rows:
            out.write(json.dumps(row) + '\n')
    for group, n in sorted(collections.Counter(r['group'] for r in rows).items()):
        print(f'{n:6d}  {group}')
    print(f'{len(rows)} rows -> {args.manifest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
