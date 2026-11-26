import { describe, expect, it } from 'vitest';

import saved from './__fixtures__/diagram-title-block-upload.json';
import {
  isCreasePatternAsset,
  setStepText,
  setTitleBlockContent,
  setTitleBlockPatternUpload,
  withReferencedAssets,
  type DiagramCreasePatternAsset,
  type DiagramDocument,
} from './diagramDocument';
import { readDiagram, writeDiagram } from './diagramFile';
import { resolveTitleBlock } from '../pages/titleBlockContent';

/**
 * A diagram whose title block draws a crease pattern uploaded from a file
 * (`implementation-plans/diagram-title-block-final-cp.md`), as this build
 * writes it: the pattern `{ kind: 'upload', assetId }`, and the asset of kind
 * `crease-pattern` — the file's name and its lines, a waterbomb base and one
 * aux line, as one JSON string fitted to a 1000-unit box.
 *
 * A change that reads it otherwise, or writes it back otherwise, changes what
 * a saved upload means, and fails here first.
 */
type SavedDiagram = Record<string, unknown> & { titleBlockContent: Record<string, unknown>; assets: Record<string, Record<string, unknown>> };
const fixture = () => JSON.parse(JSON.stringify(saved)) as SavedDiagram;
const read = (value: unknown = fixture()) => readDiagram(value)!;
const written = (document: DiagramDocument) => JSON.parse(JSON.stringify(writeDiagram(document))) as SavedDiagram;
const ASSET = 'asset-final-cp';

describe('a diagram whose title block draws an uploaded crease pattern', () => {
  it('opens editable, its pattern the file, every line of the file kept', () => {
    const { readOnly, document } = read();
    expect(readOnly).toBe(false);
    expect(document.newer).toBeUndefined();
    expect(document.titleBlockContent?.pattern).toEqual({ kind: 'upload', assetId: ASSET });
    const asset = document.assets[ASSET];
    expect(isCreasePatternAsset(asset)).toBe(true);
    const { name, pattern, bytes } = asset as DiagramCreasePatternAsset;
    expect(name).toBe('waterbomb.cp');
    expect(pattern.viewBox).toBe('0 0 1000 1000');
    expect(pattern.strokes.map((stroke) => stroke.role).sort()).toEqual(
      ['aux', 'edge', 'edge', 'edge', 'edge', 'mountain', 'mountain', 'valley', 'valley'].sort()
    );
    expect(bytes).toBe((fixture().assets[ASSET]!.pattern as string).length);
  });

  it('draws the file’s folds and edge in the block, leaving its aux line out', () => {
    const { pattern } = resolveTitleBlock(read().document);
    expect([pattern.from, pattern.step, pattern.number]).toEqual(['upload', null, null]);
    const roles = pattern.scene?.items.map((item) => (item.kind === 'line' ? item.role : item.kind));
    expect(roles?.sort()).toEqual(['edge', 'edge', 'edge', 'edge', 'mountain', 'mountain', 'valley', 'valley'].sort());
    expect(pattern.scene?.bounds).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
  });

  it('writes it back exactly, byte for byte', () => {
    expect(JSON.stringify(written(read().document))).toBe(JSON.stringify(fixture()));
  });

  it('keeps the asset through an edit and a save, and lets it go once the pattern is set to anything else', () => {
    const { document } = read();
    const edited = withReferencedAssets(setStepText(document, 'step-base', 'Fold in half.'));
    expect(Object.keys(edited.assets)).toEqual([ASSET]);
    expect(written(edited).titleBlockContent).toEqual(fixture().titleBlockContent);
    for (const pattern of ['auto', { kind: 'none' as const }, { kind: 'step' as const, stepId: 'step-base' }] as const) {
      const set = withReferencedAssets(setTitleBlockContent(document, { pattern }));
      expect(set.assets, JSON.stringify(pattern)).toEqual({});
      expect(written(set).assets, JSON.stringify(pattern)).toEqual({});
    }
  });

  it('reads a pattern naming no crease pattern as Auto: a missing asset, or one of another kind', () => {
    const missing = fixture();
    missing.assets = {};
    const opened = read(missing).document;
    expect(opened.titleBlockContent).not.toHaveProperty('pattern');
    expect(opened.newer).toBeUndefined();
    expect(resolveTitleBlock(opened).pattern.from).toBe('auto');
    const picture = fixture();
    picture.assets = {
      [ASSET]: { id: ASSET, kind: 'raster', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAAAAAA', widthPx: 1, heightPx: 1, bytes: 66 },
    };
    expect(read(picture).document.titleBlockContent).not.toHaveProperty('pattern');
    const noId = fixture();
    noId.titleBlockContent.pattern = { kind: 'upload' };
    expect(read(noId).document.titleBlockContent).not.toHaveProperty('pattern');
  });

  it('carries a newer build’s upload, and its asset, as they came, showing Auto', () => {
    // Lines with a role this build has no name for: the asset is a newer build's, and so the pattern naming it.
    const newerLines = fixture();
    const lines = JSON.parse(newerLines.assets[ASSET]!.pattern as string) as { strokes: Record<string, unknown>[] };
    lines.strokes[0]!.role = 'cut';
    newerLines.assets[ASSET]!.pattern = JSON.stringify(lines);
    // A field of the part, or of the asset, this build has no name for.
    const newerPart = fixture();
    newerPart.titleBlockContent.pattern = { kind: 'upload', assetId: ASSET, turn: 90 };
    const newerAsset = fixture();
    newerAsset.assets[ASSET]!.units = 'mm';
    for (const [label, file] of [['lines', newerLines], ['part', newerPart], ['asset', newerAsset]] as const) {
      const { document } = read(file);
      expect(document.titleBlockContent ?? {}, label).not.toHaveProperty('pattern');
      expect(document.newer?.titleBlockContent?.pattern, label).toEqual(file.titleBlockContent.pattern);
      expect(resolveTitleBlock(document).pattern.from, label).toBe('auto');
      expect(JSON.stringify(written(document)), label).toBe(JSON.stringify(file));
    }
  });

  it('takes no file for the model: a model of kind `upload` is a newer build’s, carried and shown as Auto', () => {
    const file = fixture();
    file.titleBlockContent = { ...file.titleBlockContent, model: { kind: 'upload', assetId: ASSET } };
    const { document } = read(file);
    expect(document.titleBlockContent).not.toHaveProperty('model');
    expect(document.newer?.titleBlockContent?.model).toEqual({ kind: 'upload', assetId: ASSET });
    expect(resolveTitleBlock(document).model.from).toBe('auto');
  });

  it('shows no step a crease pattern: a step naming one as its picture reads with none', () => {
    const file = fixture();
    const steps = file.steps as Record<string, unknown>[];
    steps[0] = {
      ...steps[0],
      source: { kind: 'upload', assetId: ASSET, rotationQuarterTurns: 0, mirrored: false },
      picture: { kind: 'asset', assetId: ASSET, paperScale: null, key: `upload-${ASSET}` },
    };
    const { document } = read(file);
    const step = document.steps[0] as { source: unknown; picture: unknown };
    expect([step.source, step.picture]).toEqual([null, null]);
  });
});

describe('setTitleBlockPatternUpload', () => {
  const second: DiagramCreasePatternAsset = {
    id: 'asset-second',
    kind: 'crease-pattern',
    name: 'crane.fold',
    pattern: { viewBox: '0 0 1000 1000', strokes: [{ x1: 0, y1: 0, x2: 1000, y2: 1000, role: 'valley' }] },
    bytes: 1,
  };

  it('adds the asset and sets the pattern to it in one edit; the file it replaces goes when the edit lands', () => {
    const { document } = read();
    const replaced = setTitleBlockPatternUpload(document, second);
    expect(replaced.titleBlockContent?.pattern).toEqual({ kind: 'upload', assetId: 'asset-second' });
    expect(replaced.titleBlockContent?.subtitle).toBe('Traditional');
    expect(Object.keys(withReferencedAssets(replaced).assets)).toEqual(['asset-second']);
    expect(resolveTitleBlock(replaced).pattern.scene?.items).toHaveLength(1);
  });

  it('lets go of a newer build’s pattern, as any setting of the pattern does', () => {
    const file = fixture();
    file.titleBlockContent.pattern = { kind: 'own', region: 'r-1' };
    const { document } = read(file);
    expect(document.newer?.titleBlockContent).toHaveProperty('pattern');
    const set = setTitleBlockPatternUpload(document, second);
    expect(set.newer).toBeUndefined();
    expect(written(set).titleBlockContent.pattern).toEqual({ kind: 'upload', assetId: 'asset-second' });
  });
});
