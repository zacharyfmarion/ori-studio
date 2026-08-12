import { defaultBpDocumentSymmetry } from './bpTreeSymmetry';
import { describe, expect, it } from 'vitest';
import { createCpImage, type CpImage } from '../cp-workspace/images/cpImage';
import { createTextAnnotation } from '../cp-workspace/annotations/textAnnotation';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from './foldAngle';
import {
  blockingExportLoss,
  collectExportLossWarnings,
  exportFormatLabel,
} from './supersetFeatures';

function crease(color: string, foldMagnitude?: number): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 1, y: 0 },
    color,
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  };
}

function image(): CpImage {
  return createCpImage({
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 10,
    naturalHeight: 10,
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
  });
}

const noneElse = {
  richText: [] as [],
  inlineSimulations: [] as [],
  lineSegments: [] as [],
  foldedFigures: [] as [],
  bpSymmetry: defaultBpDocumentSymmetry(),
};

describe('collectExportLossWarnings', () => {
  it('warns about images for every Oriedita-compatible format', () => {
    const presence = {
      images: [image(), image()],
      richText: [],
      inlineSimulations: [],
      lineSegments: [],
      foldedFigures: [],
      bpSymmetry: defaultBpDocumentSymmetry(),
    };
    for (const format of ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj', 'svg', 'png'] as const) {
      const warnings = collectExportLossWarnings(format, presence);
      expect(warnings).toEqual([{ id: 'images', count: 2, blocking: false }]);
    }
  });

  it('warns that rich-text formatting is dropped on every non-.osf format', () => {
    const presence = {
      images: [],
      richText: [createTextAnnotation({ center: { x: 0, y: 0 } })],
      inlineSimulations: [],
      lineSegments: [],
      foldedFigures: [],
      bpSymmetry: defaultBpDocumentSymmetry(),
    };
    expect(collectExportLossWarnings('ori', presence)).toEqual([
      { id: 'richText', count: 1, blocking: false },
    ]);
  });

  it('is empty when there are no superset features', () => {
    expect(collectExportLossWarnings('cp', { images: [], ...noneElse })).toEqual([]);
  });

  it('warns that simulation windows are dropped on every non-.osf format', () => {
    // Placement and the region each window came from; no Oriedita format has
    // anywhere to put either, so they go whole rather than degraded.
    const presence = {
      images: [],
      richText: [] as [],
      lineSegments: [] as [],
      foldedFigures: [] as [],
      inlineSimulations: [{ id: 'a' } as never, { id: 'b' } as never],
      bpSymmetry: defaultBpDocumentSymmetry(),
    };
    expect(collectExportLossWarnings('cp', presence)).toEqual([
      { id: 'inlineSimulations', count: 2, blocking: false },
    ]);
    expect(collectExportLossWarnings('fold', presence)).toHaveLength(1);
  });

  it('warns that .bps drops mirror symmetry, and only .bps', () => {
    const presence = {
      ...noneElse,
      images: [],
      bpSymmetry: { enabled: true, fold: 'book' as const, quarterTurn: false, sidesSwapped: false, pairs: [{ v1: 1, v2: 2 }] },
    };
    expect(collectExportLossWarnings('bps', presence)).toEqual([
      { id: 'symmetry', count: 1, blocking: false },
    ]);
    // The two surfaces do not overlap: a crease-pattern format never carries a
    // box-pleat design, so it has no symmetry to drop.
    for (const format of ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj', 'svg', 'png'] as const) {
      expect(collectExportLossWarnings(format, presence)).toEqual([]);
    }
  });

  it('says nothing when the design has the symmetry a fresh open would give', () => {
    // Reopening the .bps hands back the default, so a design still sitting on it
    // lost nothing. Written against `defaultBpDocumentSymmetry()` rather than a
    // literal, so this stays a statement about the default and not about which
    // value the default currently happens to be.
    const presence = { ...noneElse, images: [], bpSymmetry: defaultBpDocumentSymmetry() };
    expect(collectExportLossWarnings('bps', presence)).toEqual([]);
  });

  it('warns when mirror draw was turned on, or the fold changed, with nothing paired', () => {
    for (const bpSymmetry of [
      { enabled: true, fold: 'book' as const, quarterTurn: false, sidesSwapped: false, pairs: [] },
      { enabled: false, fold: 'diagonal' as const, quarterTurn: false, sidesSwapped: false, pairs: [] },
    ]) {
      const warnings = collectExportLossWarnings('bps', { ...noneElse, images: [], bpSymmetry });
      expect(warnings.map((warning) => warning.id)).toEqual(['symmetry']);
    }
  });

  it('never refuses a .bps export — the design still means what it meant', () => {
    const warnings = collectExportLossWarnings('bps', {
      ...noneElse,
      images: [],
      bpSymmetry: { enabled: false, fold: 'diagonal' as const, quarterTurn: false, sidesSwapped: false, pairs: [{ v1: 1, v2: 2 }] },
    });
    expect(blockingExportLoss(warnings)).toEqual([]);
  });

  it('counts the loss and labels the format', () => {
    // The features' own names are localized, so they live with the other
    // translated data labels — see `i18n/supersetFeatureLabels.test.ts`. A
    // format name is verbatim in every locale.
    const warnings = collectExportLossWarnings('cp', {
      images: [image(), image(), image()],
      ...noneElse,
    });
    expect(warnings).toEqual([{ id: 'images', count: 3, blocking: false }]);
    expect(exportFormatLabel('fold')).toBe('FOLD');
  });
});

describe('non-flat fold angles block an export rather than warning', () => {
  const presence = (segments: OristudioCpLineSegment[]) => ({
    images: [],
    richText: [] as [],
    inlineSimulations: [] as [],
    lineSegments: segments,
    foldedFigures: [] as [],
    bpSymmetry: defaultBpDocumentSymmetry(),
  });
  const ninety = 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE;

  it('blocks every format that round-trips crease semantics', () => {
    // Losing an angle is not recoverable the way losing an image is: re-import
    // and every crease reads as a full +/-180, with nothing to say otherwise.
    for (const format of ['cp', 'ori', 'orh', 'dxf', 'obj'] as const) {
      const warnings = collectExportLossWarnings(format, presence([crease('Red1', ninety)]));
      expect(blockingExportLoss(warnings)).toEqual([
        { id: 'foldAngles', count: 1, blocking: true },
      ]);
    }
  });

  it('does not block .fold, which carries the angle losslessly', () => {
    const warnings = collectExportLossWarnings('fold', presence([crease('Red1', ninety)]));
    expect(blockingExportLoss(warnings)).toEqual([]);
  });

  it('does not block image formats, which are not re-imported as patterns', () => {
    for (const format of ['svg', 'png'] as const) {
      const warnings = collectExportLossWarnings(format, presence([crease('Red1', ninety)]));
      expect(blockingExportLoss(warnings)).toEqual([]);
    }
  });

  it('ignores classic creases and non-crease lines', () => {
    const segments = [
      crease('Red1'),
      crease('Blue2', 180 * FOLD_MAGNITUDE_UNITS_PER_DEGREE),
      crease('Black0', ninety),
      crease('Cyan3', ninety),
    ];
    expect(collectExportLossWarnings('cp', presence(segments))).toEqual([]);
  });
});

describe('3D folded figures survive .fold, and only while they hold a session', () => {
  const figure = (
    kind: 'flat' | 'spatial',
    handle: number | null = 1
  ): OristudioCpFoldedFigureEntry =>
    ({
      id: `figure-${kind}-${handle}`,
      handle,
      status: 'ready',
      snapshot: kind === 'flat' ? ({} as never) : null,
      folded3d: kind === 'spatial' ? ({} as never) : null,
      renderSnapshot: null,
    }) as unknown as OristudioCpFoldedFigureEntry;

  const presence = (figures: OristudioCpFoldedFigureEntry[]) => ({
    images: [],
    richText: [] as [],
    inlineSimulations: [] as [],
    lineSegments: [] as [],
    foldedFigures: figures,
    bpSymmetry: defaultBpDocumentSymmetry(),
  });

  it('does not warn on .fold, which writes a foldedForm frame per figure', () => {
    const warnings = collectExportLossWarnings('fold', presence([figure('spatial')]));
    expect(warnings).toEqual([]);
  });

  it('warns, without blocking, on every format that cannot carry one', () => {
    for (const format of ['cp', 'ori', 'orh', 'dxf', 'obj'] as const) {
      const warnings = collectExportLossWarnings(format, presence([figure('spatial')]));
      expect(warnings).toEqual([
        { id: 'foldedForm3d', count: 1, blocking: false },
      ]);
      // The `.osf` still has the figure, so losing it is not a reason to stop.
      expect(blockingExportLoss(warnings)).toEqual([]);
    }
  });

  it('counts only the 3D figures', () => {
    const warnings = collectExportLossWarnings(
      'cp',
      presence([figure('flat'), figure('spatial'), figure('flat', 2)])
    );
    expect(warnings).toEqual([
      { id: 'foldedForm3d', count: 1, blocking: false },
    ]);
  });

  it('warns on .fold for a figure reopened from an .osf, which has no session', () => {
    // The `foldedForm` frame is built from the live `Fold3dSession`, and none of
    // that is persisted — so this one genuinely is dropped, and saying nothing
    // would be the silent loss the whole registry exists to prevent.
    const warnings = collectExportLossWarnings('fold', presence([figure('spatial', null)]));
    expect(warnings).toEqual([
      {
        id: 'foldedForm3dDetached',
        count: 1,
        blocking: false,
      },
    ]);
    expect(blockingExportLoss(warnings)).toEqual([]);
  });

  it('files each 3D figure under exactly one of the two entries', () => {
    const warnings = collectExportLossWarnings(
      'cp',
      presence([figure('spatial'), figure('spatial', null), figure('spatial', 3)])
    );
    expect(warnings).toEqual([
      { id: 'foldedForm3d', count: 2, blocking: false },
      {
        id: 'foldedForm3dDetached',
        count: 1,
        blocking: false,
      },
    ]);
  });
});
