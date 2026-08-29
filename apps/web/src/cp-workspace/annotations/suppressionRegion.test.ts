import { describe, expect, it } from 'vitest';
import {
  CP_CHECK_CLASSES,
  DEFAULT_SUPPRESSED_CHECK_CLASSES,
  createCpSuppressionRegion,
  hasAttachedSolveInput,
  suppressesCheckClass,
  validateCpSuppressionRegion,
  validateCpSuppressionRegions,
  type CpSuppressionRegion,
  type CreateCpSuppressionRegionInput,
} from './suppressionRegion';
import {
  annotationAspectLockPolicy,
  allowedAnnotationUpdate,
  annotationCanHide,
  isSuppressionRegionAnnotation,
  isImageAnnotation,
  isTextAnnotation,
} from './annotation';
import { annotationAsTransformable } from '../canvasObjects/transformableObject';
import { collectExportLossWarnings } from '../../lib/supersetFeatures';
import { defaultBpDocumentSymmetry } from '../../lib/bpTreeSymmetry';
import {
  createNativeCreasePatternProjectFile,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../../lib/nativeProjectFile';
import { importedCpLineage } from '../../lib/oristudioCpLineage';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { OristudioCpViewportOptions } from '../../lib/creasePatternViewport';

function region(overrides: Partial<Parameters<typeof createCpSuppressionRegion>[0]> = {}) {
  return createCpSuppressionRegion({
    center: { x: 0.5, y: 0.5 },
    width: 1,
    height: 1,
    ...overrides,
  });
}

describe('createCpSuppressionRegion', () => {
  it('suppresses the two angle classes by default', () => {
    expect(region().suppress).toEqual(['kawasaki', 'bigLittleBig']);
    expect(DEFAULT_SUPPRESSED_CHECK_CLASSES).toEqual(['kawasaki', 'bigLittleBig']);
  });

  it('refuses to be created hidden — at compile time', () => {
    createCpSuppressionRegion({
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      // @ts-expect-error the input type has no `hidden`, which is the point
      hidden: true,
    });
  });

  it('is never hidden, even reached through a cast', () => {
    const sneaky = {
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      hidden: true,
    } as unknown as CreateCpSuppressionRegionInput;
    expect(createCpSuppressionRegion(sneaky).hidden).toBe(false);
  });

  it('canonicalises the suppressed set: de-duplicated, in listing order, junk dropped', () => {
    const created = region({
      suppress: ['maekawa', 'kawasaki', 'maekawa', 'nonsense'] as never,
    });
    expect(created.suppress).toEqual(['kawasaki', 'maekawa']);
  });

  it('mints a unique id and takes a supplied one', () => {
    expect(region().id).not.toEqual(region().id);
    expect(region({ id: 'region-fixed' }).id).toBe('region-fixed');
  });

  it('omits the optional fields rather than storing undefined', () => {
    expect('label' in region()).toBe(false);
    expect('solveInput' in region()).toBe(false);
  });

  it('carries an attached solve input opaquely, and that is what offers Solve', () => {
    const plain = region();
    const attached = region({ solveInput: { vertices: [], spans: [] } });
    expect(hasAttachedSolveInput(plain)).toBe(false);
    expect(hasAttachedSolveInput(attached)).toBe(true);
    expect(attached.solveInput).toEqual({ vertices: [], spans: [] });
  });
});

describe('suppressesCheckClass', () => {
  it('answers per class', () => {
    const created = region({ suppress: ['kawasaki'] });
    expect(suppressesCheckClass(created, 'kawasaki')).toBe(true);
    expect(suppressesCheckClass(created, 'maekawa')).toBe(false);
  });

  it('covers the whole vocabulary when everything is selected', () => {
    const created = region({ suppress: CP_CHECK_CLASSES });
    for (const checkClass of CP_CHECK_CLASSES) {
      expect(suppressesCheckClass(created, checkClass)).toBe(true);
    }
  });
});

describe('validateCpSuppressionRegion', () => {
  it('round-trips a region through JSON', () => {
    const created = region({ label: 'Repair', suppress: ['maekawa'], rotation: 0.5, z: 3 });
    const back = validateCpSuppressionRegion(JSON.parse(JSON.stringify(created)));
    expect(back).toEqual(created);
  });

  it('refuses a stored region that claims to be hidden', () => {
    const hidden = { ...region(), hidden: true };
    expect(validateCpSuppressionRegion(hidden)).toBeNull();
    // …and the array form drops it without taking the good ones with it.
    expect(validateCpSuppressionRegions([hidden, region({ id: 'keep' })])).toEqual([
      expect.objectContaining({ id: 'keep', hidden: false }),
    ]);
  });

  it('drops anything that is not a region, without throwing', () => {
    expect(validateCpSuppressionRegion(null)).toBeNull();
    expect(validateCpSuppressionRegion({ kind: 'image' })).toBeNull();
    expect(validateCpSuppressionRegion({ ...region(), center: { x: 0 } })).toBeNull();
    expect(validateCpSuppressionRegion({ ...region(), width: 0 })).toBeNull();
    expect(validateCpSuppressionRegion({ ...region(), height: Number.NaN })).toBeNull();
    expect(validateCpSuppressionRegions('nope')).toEqual([]);
  });

  it('falls back to the default set when the stored one is missing or garbage', () => {
    const { suppress: _dropped, ...withoutSuppress } = region();
    expect(validateCpSuppressionRegion(withoutSuppress)?.suppress).toEqual([
      'kawasaki',
      'bigLittleBig',
    ]);
    // Present but unrecognisable is a different case: the user really did have a
    // set, and every member of it is gone, so an empty one is the honest answer.
    expect(validateCpSuppressionRegion({ ...region(), suppress: ['junk'] })?.suppress).toEqual([]);
  });

  it('carries an unknown solve input through untouched', () => {
    const opaque = { vertices: [{ id: 7 }], provenance: 'junction_first_v1' };
    expect(validateCpSuppressionRegion({ ...region(), solveInput: opaque })?.solveInput).toEqual(
      opaque
    );
  });
});

describe('as a canvas annotation', () => {
  it('narrows to itself and away from the other kinds', () => {
    const created: CpSuppressionRegion = region();
    expect(isSuppressionRegionAnnotation(created)).toBe(true);
    expect(isImageAnnotation(created)).toBe(false);
    expect(isTextAnnotation(created)).toBe(false);
  });

  it('resizes free-form, and says so deliberately rather than by fallthrough', () => {
    expect(annotationAspectLockPolicy(region())).toBe('default-off');
  });

  it('is the one kind that may not be hidden', () => {
    expect(annotationCanHide(region())).toBe(false);
  });

  it('has `hidden` stripped from an update, and nothing else', () => {
    // `AnnotationUpdate` is a union, so `{ hidden: true }` typechecks against
    // the image member however the id resolves — the store is where the patch
    // and the annotation finally meet, and so where the rule has to hold.
    const created = region();
    expect(allowedAnnotationUpdate(created, { hidden: true, opacity: 0.4 })).toEqual({
      opacity: 0.4,
    });
    // The legal parts of the same patch survive: rejecting the whole update
    // would lose a real edit because it travelled next to an illegal field.
    expect(allowedAnnotationUpdate(created, { opacity: 0.4 })).toEqual({ opacity: 0.4 });
    // ...and every other kind is untouched.
    const image = { kind: 'image', id: 'i' } as unknown as Parameters<
      typeof allowedAnnotationUpdate
    >[0];
    expect(allowedAnnotationUpdate(image, { hidden: true })).toEqual({ hidden: true });
  });

  it('is transformable with no adapter of its own', () => {
    const created = region({ rotation: 0.25, locked: true });
    expect(annotationAsTransformable(created)).toEqual({
      id: created.id,
      space: 'model',
      box: { center: created.center, width: 1, height: 1, rotation: 0.25 },
      locked: true,
      hidden: false,
      aspectLock: 'default-off',
    });
  });
});

describe('export loss', () => {
  const noneElse = {
    images: [] as [],
    richText: [] as [],
    inlineSimulations: [] as [],
    suppressionRegions: [] as [],
    lineSegments: [] as [],
    foldedFigures: [] as [],
    bpSymmetry: defaultBpDocumentSymmetry(),
  };

  it('is dropped by every Oriedita-compatible format, and warns rather than refuses', () => {
    const presence = { ...noneElse, suppressionRegions: [region(), region()] };
    for (const format of ['cp', 'fold', 'ori', 'orh', 'dxf', 'obj', 'svg', 'png'] as const) {
      expect(collectExportLossWarnings(format, presence)).toEqual([
        { id: 'suppressionRegions', count: 2, blocking: false },
      ]);
    }
  });

  it('says nothing when there are none', () => {
    expect(collectExportLossWarnings('cp', { ...noneElse, suppressionRegions: [] })).toEqual([]);
    expect(collectExportLossWarnings('cp', noneElse)).toEqual([]);
  });
});

describe('.osf persistence', () => {
  const cpDocument = {
    title: 'Untitled CP',
  } as unknown as OristudioCpDocumentSnapshot;

  function projectFileWith(regions: CpSuppressionRegion[]) {
    return createNativeCreasePatternProjectFile({
      title: 'Repair',
      filename: 'repair.osf',
      path: null,
      document: cpDocument,
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: { lines: [], points: [], circles: [], texts: [], faces: [] },
      viewport: {} as OristudioCpViewportOptions,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      suppressionRegions: regions,
      appVersion: '0.0.0-test',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  it('round-trips regions through save and open', () => {
    const regions = [
      region({ id: 'plain', label: 'Fragment library', suppress: ['maekawa'] }),
      region({ id: 'warm', solveInput: { spans: [1, 2, 3] }, rotation: 0.5, opacity: 0.4 }),
    ];
    const parsed = parseNativeProjectFile(
      serializeNativeProjectFile(projectFileWith(regions))
    );
    expect(parsed.workspace.creasePattern?.creasePattern.suppressionRegions).toEqual(regions);
  });

  it('is additive: the schema version does not move for it', () => {
    // The whole point of the fourth per-kind array. If this ever fails, the
    // reason had better be a genuinely breaking change, not this one.
    expect(projectFileWith([region()]).schemaVersion).toBe(
      projectFileWith([]).schemaVersion
    );
    expect(projectFileWith([region()]).minimumReaderSchemaVersion).toBe(1);
  });

  it('reads a file written before regions existed as having none', () => {
    const file = projectFileWith([]);
    const legacy = JSON.parse(serializeNativeProjectFile(file)) as Record<string, unknown>;
    const workspace = legacy.workspace as Record<string, unknown>;
    const creasePattern = workspace.creasePattern as Record<string, unknown>;
    delete (creasePattern.creasePattern as Record<string, unknown>).suppressionRegions;
    const parsed = parseNativeProjectFile(JSON.stringify(legacy));
    expect(parsed.workspace.creasePattern?.creasePattern.suppressionRegions).toEqual([]);
  });
});
