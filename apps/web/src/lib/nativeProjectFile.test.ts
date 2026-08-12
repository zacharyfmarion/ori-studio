import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureEntry,
} from '../engine/oristudioCpTypes';
import {
  activeNativeDesign,
  createNativeBoxPleatProjectFile,
  createNativeCreasePatternProjectFile,
  createNativeProjectFile,
  createNativeTreeProjectFile,
  isNativeProjectFilename,
  NATIVE_PROJECT_SCHEMA_VERSION,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from './nativeProjectFile';
import { ProjectFileFormatError } from './projectFileError';
import { DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS, emptyOristudioCpSelection } from './creasePatternViewport';
import { importedCpLineage } from './oristudioCpLineage';

const now = new Date('2026-05-26T12:00:00.000Z');

function cpDocument(): OristudioCpDocumentSnapshot {
  return {
    title: 'Square CP',
    crease_pattern: {
      line_segments: [
        {
          a: { x: 0, y: 0 },
          b: { x: 1, y: 0 },
          active: 'Inactive0',
          color: 'Black0',
          selected: 0,
          customized: 0,
          customized_color: { red: 0, green: 0, blue: 0 },
        },
      ],
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: {
        interval_grid_size: 4,
        grid_size: 8,
        grid_xa: 1,
        grid_xb: 0,
        grid_xc: 1,
        grid_ya: 1,
        grid_yb: 0,
        grid_yc: 1,
        grid_angle: 90,
        base_state: 'WithinPaper',
        vertical_scale_position: 0,
        horizontal_scale_position: 0,
        draw_diagonal_gridlines: false,
      },
    },
    operation_frame: {
      active: false,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    },
    metadata: {},
  };
}

function foldedFigure(): OristudioCpFoldedFigureEntry {
  return {
    id: 'generated-1',
    title: 'Folded model 1',
    handle: 12,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 2,
    startingFaceId: 3,
    displayStyle: 'Transparent3',
    status: 'ready',
    placement: { offset: { x: 12, y: -8 }, scale: 1.5, rotation: 0.25 },
    sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    sourceFingerprint: 'fingerprint-1',
    sourceLineIds: [1, 2, 3],
    sourceScopedLineIds: [1, 2, 3, 4],
    snapshot: {
      model: {
        front_color: { red: 255, green: 255, blue: 50 },
        back_color: { red: 233, green: 233, blue: 233 },
        line_color: { red: 0, green: 0, blue: 0 },
        scale: 1,
        rotation: 0,
        anti_alias: true,
        display_shadows: true,
        state: 'Back1',
        folded_cases: 1,
        transparent_transparency: 64,
        transparency_color: true,
      },
      estimation_step: 'Step5',
      display_style: 'Paper5',
      discovered_fold_cases: 2,
      find_another_overlap_valid: false,
      text_result: 'Number of found solutions = 2',
      wireframe: null,
    },
    renderSnapshot: {
      schema_version: 1,
      fixture: null,
      pass: 'transparent-color-back-full',
      primitives: [],
    },
    error: null,
  };
}

/**
 * A **3D** folded figure, which is a different shape: `snapshot` is null,
 * `folded3d` is the witness, and it carries the viewpoint its stored picture was
 * projected from.
 *
 * The `folded3d` payload is deliberately partial and cast — this file tests the
 * reader, and what the reader promises about that field is that it survives, not
 * that it is validated field by field.
 */
function folded3dFigure(): OristudioCpFoldedFigureEntry {
  const flat = foldedFigure();
  return {
    ...flat,
    id: 'generated-3d-1',
    sourceKind: 'generated-3d',
    snapshot: null,
    folded3d: {
      schema_version: 1,
      discovered_fold_cases: 8,
      current_fold_case: 3,
      find_another_overlap_valid: true,
      has_next_solution: true,
      verdict: { verdict: 'local_crossing', vertices: 2 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    camera: { yaw: 0.5, pitch: -0.35, zoom: 1.25 },
  };
}

/** Loosely-typed file object, for fixtures that reshape raw JSON. */
type LegacyShaped = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Rewrite a v8 file object into the v1–v7 shape, so a fixture that lowers
 * `schemaVersion` actually looks like a file that version wrote.
 *
 * Setting the version alone is not enough: v8 splits the old flat `documents`
 * array into `designs` + `creasePattern`, so a "v6" file still carrying the new
 * shape exercises the wrong reader.
 */
function asLegacyFile(v8: LegacyShaped, schemaVersion: number): LegacyShaped {
  const documents: Record<string, unknown>[] = [];
  for (const design of v8.workspace.designs ?? []) {
    if (design.payload.kind === 'box-pleat') {
      documents.push({
        id: design.id,
        kind: 'box-pleat',
        title: design.title,
        source: null,
        project: { engine: 'oristudio-bp', format: 'bps', text: design.payload.text },
        symmetry: design.viewState.symmetry,
        extensions: design.extensions ?? {},
      });
    } else {
      documents.push({
        id: design.id,
        kind: 'treemaker-tree',
        title: design.title,
        source: null,
        tree: { format: 'tmd5', text: design.payload.text },
        extensions: design.extensions ?? {},
      });
    }
  }
  if (v8.workspace.creasePattern) documents.push(v8.workspace.creasePattern);
  const activeMode =
    documents[0]?.kind === 'box-pleat'
      ? 'box-pleat'
      : documents[0]?.kind === 'treemaker-tree'
        ? 'tree'
        : 'crease-pattern';
  return {
    ...v8,
    schemaVersion,
    minimumReaderSchemaVersion: 1,
    workspace: {
      id: v8.workspace.id,
      title: v8.workspace.title,
      activeDocumentId: documents[0]?.id ?? 'crease-pattern',
      activeMode,
      documents,
      viewState: v8.workspace.viewState ?? {},
    },
  };
}


describe('native project file', () => {
  it('serializes and parses tree documents as an Ori Studio project', () => {
    const file = createNativeTreeProjectFile({
      title: 'Tree design',
      filename: 'tree.tmd5',
      path: '/tmp/tree.tmd5',
      tmd5Text: 'tm text',
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    const document = activeNativeDesign(parsed);

    expect(isNativeProjectFilename('design.osf')).toBe(true);
    expect(parsed.format).toBe('oristudio.project');
    expect(document).toMatchObject({
      title: 'Tree design',
      payload: { kind: 'treemaker', format: 'tmd5', text: 'tm text' },
    });
  });

  it('preserves editable CP snapshots, fold projection, and view state', () => {
    const selection = { ...emptyOristudioCpSelection(), lines: [1] };
    const documentSnapshot = cpDocument();
    const persistedFoldedFigure = foldedFigure();
    documentSnapshot.crease_pattern.line_segments[0].color = 'Purple8';
    const file = createNativeCreasePatternProjectFile({
      title: 'Square CP',
      filename: 'square.cp',
      path: '/tmp/square.cp',
      document: documentSnapshot,
      source: { format: 'cp', filename: 'square.cp', path: '/tmp/square.cp' },
      foldProjection: {
        file_spec: 1.2,
        frame_classes: ['creasePattern'],
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
        edges_foldAngle: [null],
        faces_vertices: [],
      },
      sourceFold: {
        file_spec: 1.2,
        file_title: 'imported multi-frame',
        frame_classes: ['creasePattern'],
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
        faces_vertices: [],
        file_frames: [
          {
            frame_title: 'embedded folded',
            frame_classes: ['foldedForm'],
            frame_parent: 0,
            frame_inherit: true,
            vertices_coords: [
              [0, 0],
              [0.5, 0],
              [0, 0.5],
            ],
            edges_vertices: [
              [0, 1],
              [1, 2],
              [2, 0],
            ],
            faces_vertices: [[0, 1, 2]],
          },
        ],
      },
      foldArtifacts: null,
      creaseColorMode: 'agrh',
      selection,
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [persistedFoldedFigure],
      activeFoldedFigureId: persistedFoldedFigure.id,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));

    // A crease pattern is not a design: v8 stores it in its own field, and the
    // file holds no design tabs at all.
    expect(activeNativeDesign(parsed)).toBeNull();
    expect(parsed.workspace.designs).toEqual([]);
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.document.crease_pattern.line_segments).toHaveLength(1);
    expect(document.creasePattern.document.crease_pattern.line_segments[0].color).toBe('Purple8');
    expect(document.creasePattern.foldProjection?.edges_vertices).toEqual([[0, 1]]);
    expect(document.creasePattern.sourceFold?.file_title).toBe('imported multi-frame');
    expect(document.creasePattern.sourceFold?.file_frames?.[0]?.frame_classes).toEqual([
      'foldedForm',
    ]);
    expect(document.viewState).toMatchObject({
      creaseColorMode: 'agrh',
      selection: { lines: [1] },
      foldedFigures: [
        expect.objectContaining({
          id: 'generated-1',
          handle: null,
          displayStyle: 'Transparent3',
          placement: { offset: { x: 12, y: -8 }, scale: 1.5, rotation: 0.25 },
          renderSnapshot: expect.objectContaining({ pass: 'transparent-color-back-full' }),
        }),
      ],
      activeFoldedFigureId: 'generated-1',
    });
  });

  it('reads a pre-placement folded figure by lifting displayOffset into an identity placement', () => {
    // Files written before folded figures gained a full placement carry only a
    // `displayOffset` point, which is exactly an unscaled, unrotated placement.
    const file = createNativeCreasePatternProjectFile({
      title: 'Legacy CP',
      filename: 'legacy.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const serialized = JSON.parse(serializeNativeProjectFile(file));
    const entry = serialized.workspace.creasePattern.viewState.foldedFigures[0];
    delete entry.placement;
    entry.displayOffset = { x: 12, y: -8 };

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0].placement).toEqual({
      offset: { x: 12, y: -8 },
      scale: 1,
      rotation: 0,
    });
  });

  it('round-trips a folded figure’s source region, so it can still be refolded', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Provenance CP',
      filename: 'provenance.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0]).toMatchObject({
      sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      sourceFingerprint: 'fingerprint-1',
      sourceLineIds: [1, 2, 3],
      // The two lists are separately recorded because neither derives from the
      // other: the kernel indexes into the filtered one, and only the
      // unfiltered one matches a region for "simulate instead".
      sourceScopedLineIds: [1, 2, 3, 4],
    });
  });

  // Files written before provenance was tracked simply offer no refold; they
  // must not fail to load, and must not claim a region they do not have.
  it('loads a folded figure with no recorded source region', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Legacy CP',
      filename: 'legacy.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const serialized = JSON.parse(serializeNativeProjectFile(file));
    const entry = serialized.workspace.creasePattern.viewState.foldedFigures[0];
    delete entry.sourceBounds;
    delete entry.sourceFingerprint;
    delete entry.sourceLineIds;
    delete entry.sourceScopedLineIds;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0]).toMatchObject({
      sourceBounds: null,
      sourceFingerprint: null,
      sourceLineIds: [],
      sourceScopedLineIds: [],
    });
  });

  // A file written before the scoped list existed still has one honest answer
  // for which creases the fold covered, and reading it as empty would silently
  // disable "simulate instead" on every reopened 3D figure.
  it('falls back to the folded ids when a file records no scoped ids', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Pre-scoping CP',
      filename: 'pre-scoping.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const serialized = JSON.parse(serializeNativeProjectFile(file));
    delete serialized.workspace.creasePattern.viewState.foldedFigures[0].sourceScopedLineIds;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0].sourceScopedLineIds).toEqual([1, 2, 3]);
  });

  it('drops a malformed source region rather than trusting a partial box', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Bad bounds CP',
      filename: 'bad-bounds.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const serialized = JSON.parse(serializeNativeProjectFile(file));
    serialized.workspace.creasePattern.viewState.foldedFigures[0].sourceBounds = { minX: 0 };

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0].sourceBounds).toBeNull();
  });

  /**
   * The writer spreads the whole entry and the reader rebuilds an explicit
   * literal, so a field the reader forgets to name is written out and silently
   * lost on the way back — with no type error anywhere. `contradiction` was lost
   * that way for months before this test existed.
   */
  function roundTripCp(figures: OristudioCpFoldedFigureEntry[]) {
    const file = createNativeCreasePatternProjectFile({
      title: '3D CP',
      filename: 'spatial.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: figures,
      activeFoldedFigureId: figures[0]?.id ?? null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    return { file, serialized: JSON.parse(serializeNativeProjectFile(file)) as LegacyShaped };
  }

  function reparse(serialized: LegacyShaped): OristudioCpFoldedFigureEntry[] {
    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    return document.viewState.foldedFigures;
  }

  it('round-trips a 3D folded figure: its snapshot, its kind and its viewpoint', () => {
    const [entry] = reparse(roundTripCp([folded3dFigure()]).serialized);

    // The witness the whole UI branches on. Without it a reopened 3D figure is
    // a picture the app believes is flat.
    expect(entry.folded3d).toMatchObject({
      discovered_fold_cases: 8,
      current_fold_case: 3,
      verdict: { verdict: 'local_crossing', vertices: 2 },
    });
    expect(entry.snapshot).toBeNull();
    expect(entry.sourceKind).toBe('generated-3d');
    // Cannot be applied on load — re-projecting needs the render model, which is
    // deliberately not persisted — but it is what a refold restores, so losing
    // it would move the figure the first time it was refolded.
    expect(entry.camera).toEqual({ yaw: 0.5, pitch: -0.35, zoom: 1.25 });
    // Persisted, so a reopened figure draws immediately with `handle: null`.
    expect(entry.renderSnapshot).not.toBeNull();
    expect(entry.handle).toBeNull();
  });

  it('keeps the schema version where it is, so a 3D file still opens in the build before this one', () => {
    const { serialized } = roundTripCp([folded3dFigure()]);
    // `schemaVersion` is written unconditionally and the reader's accept list is
    // a hardcoded enumeration, so a bump is not conditional on anything: it
    // would strand every file this build writes, 3D or not. The figure is what
    // gates, not the file.
    expect(serialized.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);
    expect(serialized.minimumReaderSchemaVersion).toBe(1);
  });

  it('carries a fold contradiction back, which the reader used to drop', () => {
    const contradiction = { upper_face: 3, lower_face: 7 };
    const [entry] = reparse(roundTripCp([{ ...foldedFigure(), contradiction }]).serialized);
    expect(entry.contradiction).toEqual(contradiction);
  });

  it('loads a figure written before any of the 3D fields existed', () => {
    const { serialized } = roundTripCp([foldedFigure()]);
    const stored = serialized.workspace.creasePattern.viewState.foldedFigures[0];
    delete stored.folded3d;
    delete stored.camera;
    delete stored.contradiction;

    const [entry] = reparse(serialized);
    expect(entry.folded3d).toBeNull();
    expect(entry.camera).toBeNull();
    expect(entry.contradiction).toBeNull();
    expect(entry.sourceKind).toBe('generated-from-current-cp');
    expect(entry.snapshot).not.toBeNull();
  });

  it('does not read an unrecognised source kind as one folded from the current creases', () => {
    const { serialized } = roundTripCp([foldedFigure()]);
    serialized.workspace.creasePattern.viewState.foldedFigures[0].sourceKind =
      'generated-in-a-later-build';

    // The old fallback was `'generated-from-current-cp'` — the one value that
    // makes a figure look refoldable — so a figure from a newer build would be
    // handed to whichever folder this build has. `'unknown'` offers nothing.
    expect(reparse(serialized)[0].sourceKind).toBe('unknown');
  });

  it('trusts the 3D witness over the label beside it', () => {
    const { serialized } = roundTripCp([folded3dFigure()]);
    const stored = serialized.workspace.creasePattern.viewState.foldedFigures[0];
    // What a file written before `'generated-3d'` existed looks like, and what a
    // reader that dropped `folded3d` while keeping the entry would produce if
    // the two ever disagreed the other way.
    stored.sourceKind = 'generated-from-current-cp';
    stored.snapshot = foldedFigure().snapshot;

    const [entry] = reparse(serialized);
    expect(entry.sourceKind).toBe('generated-3d');
    // Both witnesses non-null is a state nothing branches on; the flat one loses.
    expect(entry.snapshot).toBeNull();
    expect(entry.folded3d).not.toBeNull();
  });

  it('falls back to an identity placement when a folded figure carries neither shape', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Bare CP',
      filename: 'bare.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const serialized = JSON.parse(serializeNativeProjectFile(file));
    delete serialized.workspace.creasePattern.viewState.foldedFigures[0].placement;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0].placement).toEqual({
      offset: { x: 0, y: 0 },
      scale: 1,
      rotation: 0,
    });
  });

  it('rejects a non-positive persisted scale rather than collapsing the figure', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Bad scale CP',
      filename: 'bad.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [foldedFigure()],
      activeFoldedFigureId: 'generated-1',
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const serialized = JSON.parse(serializeNativeProjectFile(file));
    serialized.workspace.creasePattern.viewState.foldedFigures[0].placement.scale = 0;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0].placement.scale).toBe(1);
  });

  it('stores generated CP companions inside tree projects', () => {
    const file = createNativeTreeProjectFile({
      title: 'Tree with CP',
      filename: 'tree.osf',
      path: '/tmp/tree.osf',
      tmd5Text: 'tm text',
      creasePatternCompanion: {
        title: 'Generated CP',
        document: cpDocument(),
        source: null,
        foldProjection: null,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
      },
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));

    expect(parsed.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);
    expect(parsed.workspace.designs.map((design) => design.payload.kind)).toEqual(['treemaker']);
    expect(parsed.workspace.creasePattern).not.toBeNull();
    expect(parsed.workspace.activeDocumentId).toBe('tree');
  });

  it('round-trips a box-pleat design with its crease-pattern companion', () => {
    const file = createNativeBoxPleatProjectFile({
      title: 'Crane',
      filename: 'crane.osf',
      path: '/tmp/crane.osf',
      bps: '{"title":"Crane","tree":{}}',
      creasePatternCompanion: {
        title: 'Crane CP',
        document: cpDocument(),
        source: null,
        foldProjection: null,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
      },
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));

        expect(parsed.workspace.activeDocumentId).toBe('box-pleat');
    expect(parsed.workspace.designs.map((design) => design.payload.kind)).toEqual(['box-pleat']);
    expect(parsed.workspace.creasePattern).not.toBeNull();
    const active = activeNativeDesign(parsed);
    if (!active) throw new Error('expected a box-pleat design');
    expect(active.payload).toEqual({
      kind: 'box-pleat',
      format: 'bps',
      text: '{"title":"Crane","tree":{}}',
    });
  });

  it('serializes a tree design, a box-pleat design, and a crease pattern together', () => {
    const file = createNativeProjectFile({
      workspaceTitle: 'Multi',
      filename: 'multi.osf',
      path: '/tmp/multi.osf',
      designs: [
        { id: 'tree', title: 'Multi tree', kind: 'treemaker', text: 'tmd5-body', format: 'tmd5' },
        { id: 'box-pleat', title: 'Multi bp', kind: 'box-pleat', text: '{"tree":{}}', format: 'bps' },
      ],
      activeDesignId: 'tree',
      creasePattern: {
        title: 'Multi CP',
        document: cpDocument(),
        source: null,
        foldProjection: null,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
      },
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));

    // All three documents coexist in the one workspace container.
    // Two designs and one crease pattern: the designs are tabs, in order; the
    // crease pattern is not a tab and lives in its own field.
    expect(parsed.workspace.designs.map((design) => design.payload.kind)).toEqual([
      'treemaker',
      'box-pleat',
    ]);
    expect(parsed.workspace.creasePattern).not.toBeNull();
    expect(parsed.workspace.activeDocumentId).toBe('tree');
    expect(activeNativeDesign(parsed)?.payload.kind).toBe('treemaker');
    // More than one design is not expressible in v1–v7, so the file says so.
    expect(parsed.minimumReaderSchemaVersion).toBe(8);
  });

  it('round-trips many designs of mixed kinds, in tab order', () => {
    // The capability the whole schema change exists for. v1-v7 could hold at
    // most one design per kind, under a constant id, so this file was not
    // expressible at all.
    const file = createNativeProjectFile({
      workspaceTitle: 'Menagerie',
      filename: 'menagerie.osf',
      path: null,
      designs: [
        { id: 'd1', title: 'Crane', kind: 'treemaker', text: 'crane-tmd5', format: 'tmd5' },
        { id: 'd2', title: 'Beetle', kind: 'box-pleat', text: '{"beetle":1}', format: 'bps' },
        { id: 'd3', title: 'Crane II', kind: 'treemaker', text: 'crane2-tmd5', format: 'tmd5' },
      ],
      activeDesignId: 'd2',
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));

    expect(parsed.workspace.designs.map((design) => [design.id, design.title])).toEqual([
      ['d1', 'Crane'],
      ['d2', 'Beetle'],
      ['d3', 'Crane II'],
    ]);
    expect(parsed.workspace.designs.map((design) => design.payload.text)).toEqual([
      'crane-tmd5',
      '{"beetle":1}',
      'crane2-tmd5',
    ]);
    expect(parsed.workspace.activeDocumentId).toBe('d2');
  });

  it('keeps a design of an unrecognized kind rather than destroying it', () => {
    const file = JSON.parse(
      serializeNativeProjectFile(
        createNativeProjectFile({
          workspaceTitle: 'Future',
          filename: 'future.osf',
          path: null,
          designs: [
            { id: 'd1', title: 'Crane', kind: 'treemaker', text: 'crane', format: 'tmd5' },
          ],
          appVersion: '0.1.1',
          now,
        })
      )
    );
    file.workspace.designs.push({
      id: 'd2',
      title: 'Woven',
      payload: { kind: 'weave-o-matic', text: 'opaque', format: 'wv' },
      viewState: {},
      extensions: {},
    });

    const parsed = parseNativeProjectFile(JSON.stringify(file));

    // The tab this build understands opens; the one it does not is held aside
    // verbatim so the next save cannot silently delete someone else's work.
    expect(parsed.workspace.designs.map((design) => design.id)).toEqual(['d1']);
    expect(parsed.workspace.unknownDesigns).toHaveLength(1);
    expect(parsed.workspace.unknownDesigns[0]).toMatchObject({ id: 'd2' });
  });

  it('refuses a design that claims the reserved crease-pattern id', () => {
    const file = JSON.parse(
      serializeNativeProjectFile(
        createNativeProjectFile({
          workspaceTitle: 'Clash',
          filename: 'clash.osf',
          path: null,
          designs: [{ id: 'd1', title: 'Crane', kind: 'treemaker', text: 'c', format: 'tmd5' }],
          appVersion: '0.1.1',
          now,
        })
      )
    );
    file.workspace.designs[0].id = 'crease-pattern';

    expect(() => parseNativeProjectFile(JSON.stringify(file))).toThrow(/reserved id/i);
  });

  it('migrates a legacy tree-plus-box-pleat file to two tabs, ids intact', () => {
    const legacy = asLegacyFile(
      JSON.parse(
        serializeNativeProjectFile(
          createNativeProjectFile({
            workspaceTitle: 'Legacy',
            filename: 'legacy.osf',
            path: null,
            designs: [
              { id: 'tree', title: 'Legacy tree', kind: 'treemaker', text: 't', format: 'tmd5' },
              { id: 'box-pleat', title: 'Legacy bp', kind: 'box-pleat', text: '{}', format: 'bps' },
            ],
            appVersion: '0.1.1',
            now,
          })
        )
      ),
      6
    );

    const parsed = parseNativeProjectFile(JSON.stringify(legacy));

    // Ids migrate verbatim. Renumbering to `design-N` would look tidier and
    // would detach each design from the identity anything else recorded for it.
    expect(parsed.workspace.designs.map((design) => design.id)).toEqual(['tree', 'box-pleat']);
    expect(parsed.workspace.designs.map((design) => design.payload.kind)).toEqual([
      'treemaker',
      'box-pleat',
    ]);
    // A legacy file was always readable by the build that wrote it.
    expect(parsed.minimumReaderSchemaVersion).toBe(1);
  });

  it('names the active design by id, not by kind', () => {
    const file = createNativeProjectFile({
      workspaceTitle: 'Multi',
      filename: 'multi.osf',
      path: null,
      designs: [
        { id: 'a', title: 'First crane', kind: 'treemaker', text: 'a-body', format: 'tmd5' },
        { id: 'b', title: 'Second crane', kind: 'treemaker', text: 'b-body', format: 'tmd5' },
      ],
      // Two designs of the *same* kind: the question v1–v7's kind-based lookup
      // could not answer at all.
      activeDesignId: 'b',
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    expect(parsed.workspace.activeDocumentId).toBe('b');
    expect(activeNativeDesign(parsed)?.title).toBe('Second crane');
    expect(parsed.workspace.designs.map((design) => design.payload.text)).toEqual([
      'a-body',
      'b-body',
    ]);
  });

  it('round-trips a box-pleat design with no companion crease pattern', () => {
    const file = createNativeBoxPleatProjectFile({
      title: 'Untitled',
      filename: 'untitled.osf',
      path: null,
      bps: '{"tree":{}}',
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    expect(parsed.workspace.designs.map((design) => design.payload.kind)).toEqual(['box-pleat']);
  });

  describe('canvas camera (schema v7)', () => {
    const camera = { centerX: 12.5, centerY: -40, zoom: 3.25, rotation: Math.PI / 4 };

    /** A CP file, optionally carrying a saved camera. */

    const cpFileWith = (input: { camera?: typeof camera | null }) =>
      createNativeCreasePatternProjectFile({
        title: 'Rotated CP',
        filename: 'rotated.osf',
        path: null,
        document: cpDocument(),
        source: null,
        foldProjection: null,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
        appVersion: '0.1.1',
        now,
        ...input,
      });

    const cameraOf = (raw: unknown) => {
      const parsed = parseNativeProjectFile(
        typeof raw === 'string' ? raw : JSON.stringify(raw)
      );
      const document = parsed.workspace.creasePattern;
      if (!document) throw new Error('expected CP document');
      return document.viewState.camera;
    };

    it('round-trips the camera, so a rotated canvas reopens rotated', () => {
      expect(cameraOf(serializeNativeProjectFile(cpFileWith({ camera })))).toEqual(camera);
    });

    it('writes null when the document has no camera', () => {
      expect(cameraOf(serializeNativeProjectFile(cpFileWith({})))).toBeNull();
    });

    it('opens a v6 file, which predates the camera, with no camera', () => {
      // The migration case: every file written before this feature. It must open
      // and fall back to the auto-fit, not throw.
      const raw = asLegacyFile(JSON.parse(serializeNativeProjectFile(cpFileWith({ camera }))), 6);
      delete raw.workspace.documents[0].viewState.camera;
      expect(cameraOf(raw)).toBeNull();
    });

    it('drops a malformed camera rather than refusing the file', () => {
      // A camera is a *view*: a bad one must never cost the user their geometry.
      // Zero zoom would divide by zero; an out-of-range one blanks the canvas.
      for (const junk of [null, 42, 'square', [], { zoom: 2 }, { ...camera, zoom: 0 }, { ...camera, rotation: Number.NaN }, { ...camera, zoom: 1e9 }]) {
        const raw = JSON.parse(serializeNativeProjectFile(cpFileWith({ camera })));
        raw.workspace.creasePattern.viewState.camera = junk;
        expect(cameraOf(raw)).toBeNull();
      }
    });
  });

  describe('box-pleat symmetry (schema v6)', () => {
    // These cases are about the *legacy* symmetry field, which lived at the top
    // of a v1–v7 box-pleat document; v8 carries it in the design's view state.
    const bpFile = (symmetry?: Parameters<typeof createNativeBoxPleatProjectFile>[0]['symmetry']) =>
      asLegacyFile(
        JSON.parse(
          serializeNativeProjectFile(
            createNativeBoxPleatProjectFile({
              title: 'Sym',
              filename: 'sym.osf',
              path: null,
              bps: '{"tree":{}}',
              symmetry,
              appVersion: '0.1.1',
              now,
            })
          )
        ),
        6
      );

    /** The box-pleat document of a parsed file, narrowed. */
    const bpDocumentOf = (raw: unknown) => {
      const parsed = parseNativeProjectFile(JSON.stringify(raw));
      const document = parsed.workspace.designs[0];
      if (document?.payload.kind !== 'box-pleat') {
        throw new Error('expected a box-pleat document');
      }
      // Mirror-draw state rides the design's own view state in v8; the legacy
      // migration lifts it out of the old top-level field.
      return { ...document, symmetry: document.viewState.symmetry };
    };

    it('round-trips what mirrors what, and where the mirror is', () => {
      const raw = bpFile({
        enabled: false,
        fold: 'diagonal',
        // Turned and swapped, so the case would still pass if the writer dropped
        // either field and the reader defaulted it.
        quarterTurn: true,
        sidesSwapped: true,
        pairs: [{ v1: 3, v2: 7 }],
      });
      expect(bpDocumentOf(raw).symmetry).toEqual({
        enabled: false,
        fold: 'diagonal',
        quarterTurn: true,
        sidesSwapped: true,
        pairs: [{ v1: 3, v2: 7 }],
      });
    });

    it('never writes the derived axis, which would go stale against the sheet', () => {
      // The *runtime* shape, which carries the axis. It is a subtype of the
      // persisted one, so this typechecks at every call site — which is exactly
      // why the serializer has to drop the extra fields itself.
      const runtimeState = {
        enabled: true,
        fold: 'book' as const,
        quarterTurn: false,
        sidesSwapped: false,
        pairs: [],
        angle: 90,
        loc: { x: 4, y: 4 },
      };
      const raw = bpFile(runtimeState);
      expect(Object.keys(raw.workspace.documents[0].symmetry).sort()).toEqual([
        'enabled',
        'fold',
        'pairs',
        'quarterTurn',
        'sidesSwapped',
      ]);
    });

    it('opens a v5 file, which predates symmetry, with mirror draw off', () => {
      // Off is the honest reading: nothing in a file written before symmetry
      // existed was ever mirrored, so opening it with the mirror on would put
      // a claim into the design that its author never made.
      const raw = bpFile({ enabled: false, fold: 'diagonal', quarterTurn: false, sidesSwapped: false, pairs: [{ v1: 1, v2: 2 }] });
      raw.schemaVersion = 5;
      delete raw.workspace.documents[0].symmetry;
      expect(bpDocumentOf(raw).symmetry).toEqual({ enabled: false, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [] });
    });

    it('opens rather than refuses when the symmetry block is malformed', () => {
      for (const junk of [null, 42, 'book', [], { pairs: 'nope' }]) {
        const raw = bpFile();
        raw.workspace.documents[0].symmetry = junk;
        expect(bpDocumentOf(raw).symmetry).toEqual({ enabled: false, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [] });
      }
    });

    it('keeps the usable half of a partly malformed block', () => {
      const raw = bpFile();
      raw.workspace.documents[0].symmetry = { enabled: false, fold: 'sideways', pairs: null };
      expect(bpDocumentOf(raw).symmetry).toEqual({ enabled: false, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [] });
    });

    it('re-establishes one mirror per vertex, whatever the file claims', () => {
      const raw = bpFile();
      raw.workspace.documents[0].symmetry = {
        enabled: true,
        fold: 'book',
        pairs: [
          { v1: 2, v2: 1 }, // stored the wrong way round
          { v1: 1, v2: 5 }, // vertex 1 claimed twice — the later pair wins
          { v1: 8, v2: 8 }, // a vertex paired with itself
          { v1: -1, v2: 4 }, // not a vertex id
          { v1: 2.5, v2: 6 }, // nor is this
          'nope',
        ],
      };
      expect((bpDocumentOf(raw).symmetry as { pairs: unknown }).pairs).toEqual([
        { v1: 1, v2: 5 },
      ]);
    });
  });

  it('rejects a box-pleat document with an unknown engine', () => {
    const file = JSON.parse(
      serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Bad',
          filename: 'bad.osf',
          path: null,
          bps: '{}',
          appVersion: '0.1.1',
          now,
        })
      )
    );
    // The engine field only exists in the v1–v7 shape; v8 stores a kind id.
    const legacy = asLegacyFile(file, 6);
    legacy.workspace.documents[0].project.engine = 'somethingElse';
    expect(() => parseNativeProjectFile(JSON.stringify(legacy))).toThrow(
      /Unsupported box-pleat engine/i
    );
  });

  it('defaults missing schema-1 CP lineage during migration', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Legacy CP',
      filename: 'legacy.osf',
      path: '/tmp/legacy.osf',
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const legacy = asLegacyFile(JSON.parse(serializeNativeProjectFile(file)), 1);
    delete legacy.workspace.documents[0].creasePattern.lineage;

    const parsed = parseNativeProjectFile(JSON.stringify(legacy));

    expect(parsed.schemaVersion).toBe(NATIVE_PROJECT_SCHEMA_VERSION);
    // A legacy crease-pattern-only file migrates to zero design tabs.
    expect(activeNativeDesign(parsed)).toBeNull();
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.lineage).toMatchObject({ kind: 'imported', stale: false });
  });

  it('rejects non-project and newer required schema files', () => {
    expect(() => parseNativeProjectFile('{"format":"fold"}')).toThrow(/not an Ori Studio project/i);
    expect(() =>
      parseNativeProjectFile(
        JSON.stringify({
          format: 'oristudio.project',
          schemaVersion: NATIVE_PROJECT_SCHEMA_VERSION + 1,
          minimumReaderSchemaVersion: NATIVE_PROJECT_SCHEMA_VERSION + 1,
        })
      )
    ).toThrow(/requires reader schema/i);
  });

  // Callers use the type to tell "we know exactly why this file is unopenable"
  // from an opaque failure they are free to speculate about, and the code to
  // decide which of the three things the user should be told.
  it('reports definitive rejections as project-format errors, coded by what the user can do', () => {
    const rejections: [string, string][] = [
      // Not ours at all.
      ['{"format":"fold"}', 'project_file_unrecognized'],
      ['[]', 'project_file_unrecognized'],
      // Ours, from the future — updating fixes it.
      ['{"format":"oristudio.project","schemaVersion":99}', 'project_file_too_new'],
      [
        `{"format":"oristudio.project","schemaVersion":1,"minimumReaderSchemaVersion":${NATIVE_PROJECT_SCHEMA_VERSION + 1}}`,
        'project_file_too_new',
      ],
      // Ours, but unreadable.
      ['{"format":"oristudio.project"}', 'project_file_damaged'],
      ['{"format":"oristudio.project","schemaVersion":0}', 'project_file_damaged'],
      ['{"format":"oristudio.project","schemaVersion":1}', 'project_file_damaged'],
      ['{ not json', 'project_file_damaged'],
    ];
    for (const [text, code] of rejections) {
      let thrown: unknown;
      expect(() => {
        try {
          parseNativeProjectFile(text);
        } catch (error) {
          thrown = error;
          throw error;
        }
      }).toThrow(ProjectFileFormatError);
      expect((thrown as ProjectFileFormatError).code, text).toBe(code);
    }
  });

  it('round-trips crease-pattern reference images (superset feature)', () => {
    const image = {
      kind: 'image' as const,
      id: 'image-1',
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 800,
      naturalHeight: 600,
      center: { x: 0.5, y: 0.25 },
      width: 0.8,
      height: 0.6,
      rotation: Math.PI / 6,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      opacity: 0.5,
      locked: true,
      hidden: false,
      z: 2,
    };
    const file = createNativeCreasePatternProjectFile({
      title: 'CP with image',
      filename: 'img.osf',
      path: '/tmp/img.osf',
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      images: [image],
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.images).toEqual([image]);
  });

  it('round-trips inline simulation windows (superset feature)', () => {
    const simulation = {
      id: 'inline-sim-3',
      box: { center: { x: 448, y: -102.5 }, width: 412.5, height: 412.5, rotation: Math.PI / 4 },
      z: 2,
      view: { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 },
      sourceBoundary: [
        [
          { x: -200, y: -200 },
          { x: 200, y: -200 },
          { x: 200, y: 200 },
        ],
      ],
      sourceBounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
      sourceFingerprint: 'cs1:0123456789abcdef',
      segmentIdHint: 7,
    };
    const file = createNativeCreasePatternProjectFile({
      title: 'CP with a simulation',
      filename: 'sim.osf',
      path: '/tmp/sim.osf',
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      inlineSimulations: [simulation],
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.inlineSimulations).toEqual([simulation]);
  });

  it('keeps a window whose provenance says it is stale', () => {
    // The fingerprint is what the staleness check compares against, so it has to
    // survive the round-trip byte for byte. Losing it reads as "cannot tell",
    // which the check treats as *not* stale — the indicator would simply never
    // fire again for a window restored from a file.
    const simulation = {
      id: 'inline-sim-1',
      box: { center: { x: 0, y: 0 }, width: 100, height: 100, rotation: 0 },
      z: 1,
      view: { yaw: 0, pitch: 0, zoom: 1 },
      sourceBoundary: [[
        { x: -50, y: -50 },
        { x: 50, y: -50 },
        { x: 50, y: 50 },
      ]],
      sourceBounds: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
      sourceFingerprint: 'cs1:deadbeefdeadbeef',
      segmentIdHint: null,
    };
    const file = createNativeCreasePatternProjectFile({
      title: 'Stale window',
      filename: 'stale.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      inlineSimulations: [simulation],
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.inlineSimulations[0]?.sourceFingerprint).toBe(
      'cs1:deadbeefdeadbeef'
    );
  });

  it('round-trips a non-default fold-angle display mode, with no schema change', () => {
    // The mode rides `viewState.viewport` like `lineStyle` does, so this needs
    // no version bump — but it does need saying, because the field is optional
    // and a dropped optional is invisible until someone reopens their file.
    const file = createNativeCreasePatternProjectFile({
      title: 'Angled CP',
      filename: 'angled.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: { ...DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS, foldAngleDisplay: 'opacity' },
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.viewport.foldAngleDisplay).toBe('opacity');
  });

  it('leaves a file written before the fold-angle mode on the default', () => {
    // No migration: the reader's `?? DEFAULT` at each use site is what carries
    // an older file, so the absent field must stay absent rather than be filled
    // in on read.
    const file = createNativeCreasePatternProjectFile({
      title: 'Legacy CP',
      filename: 'legacy.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const raw = JSON.parse(serializeNativeProjectFile(file));
    delete raw.workspace.creasePattern?.viewState?.viewport?.foldAngleDisplay;

    const parsed = parseNativeProjectFile(JSON.stringify(raw));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.viewState.viewport.foldAngleDisplay).toBeUndefined();
  });

  it('migrates files written before simulations to an empty list', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Legacy CP',
      filename: 'legacy.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const raw = asLegacyFile(JSON.parse(serializeNativeProjectFile(file)), 4);
    delete raw.workspace.documents[0].creasePattern.inlineSimulations;

    const parsed = parseNativeProjectFile(JSON.stringify(raw));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.inlineSimulations).toEqual([]);
  });

  it('migrates v2 files with no images to an empty image layer', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'Legacy CP',
      filename: 'legacy.osf',
      path: '/tmp/legacy.osf',
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const legacy = asLegacyFile(JSON.parse(serializeNativeProjectFile(file)), 2);
    delete legacy.workspace.documents[0].creasePattern.images;

    const parsed = parseNativeProjectFile(JSON.stringify(legacy));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.images).toEqual([]);
  });

  it('drops malformed image entries without failing the load', () => {
    const file = createNativeCreasePatternProjectFile({
      title: 'CP',
      filename: 'img.osf',
      path: null,
      document: cpDocument(),
      source: null,
      foldProjection: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.1',
      now,
    });
    const raw = JSON.parse(serializeNativeProjectFile(file));
    raw.workspace.creasePattern.creasePattern.images = [
      { id: 'bad', src: '' }, // empty src → dropped
      {
        id: 'good',
        src: 'data:image/png;base64,AAAA',
        naturalWidth: 10,
        naturalHeight: 10,
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
      },
    ];

    const parsed = parseNativeProjectFile(JSON.stringify(raw));
    const document = parsed.workspace.creasePattern;
    if (!document) throw new Error('expected CP document');
    expect(document.creasePattern.images).toHaveLength(1);
    expect(document.creasePattern.images?.[0]?.id).toBe('good');
  });

  it('preserves file- and document-level extension bags on save (forward-compat)', () => {
    const file = createNativeProjectFile({
      workspaceTitle: 'CP',
      filename: 'ext.osf',
      path: null,
      designs: [],
      creasePattern: {
        title: 'CP',
        document: cpDocument(),
        source: null,
        foldProjection: null,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
        images: [],
        extensions: { futureDocFeature: { a: 1 } },
      },
      extensions: { futureFileFeature: 'keep-me' },
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    expect(parsed.extensions).toEqual({ futureFileFeature: 'keep-me' });
    expect(parsed.workspace.creasePattern?.extensions).toEqual({ futureDocFeature: { a: 1 } });
  });
});

describe('a crease-pattern-only save', () => {
  const cpInput = (extra: Record<string, unknown> = {}) => ({
    title: 'CP',
    filename: 'cp.osf',
    path: null,
    document: { title: 'CP', lines: [], vertices: [] } as never,
    source: null,
    foldProjection: null,
    foldArtifacts: null,
    creaseColorMode: 'mvf' as const,
    selection: { lines: [], vertices: [] } as never,
    viewport: {} as never,
    foldedFigures: [],
    activeFoldedFigureId: null,
    lineage: { kind: 'blank' as const, manualEditCount: 0, stale: false },
    appVersion: '0.0.0',
    ...extra,
  });

  it('carries designs of a kind this build cannot read', () => {
    // "This file holds no designs" and "this file holds designs I cannot parse"
    // are different claims. Writing the second as the first deletes a user's
    // work on a round trip through an older build.
    const unknown = [{ id: 'design-9', title: 'From the future', payload: { kind: 'origamizer' } }];

    const file = createNativeCreasePatternProjectFile(cpInput({ unknownDesigns: unknown }));

    expect(file.workspace.designs).toEqual([]);
    expect(file.workspace.unknownDesigns).toEqual(unknown);
  });

  it('raises the reader bar when it carries one', () => {
    const file = createNativeCreasePatternProjectFile(
      cpInput({ unknownDesigns: [{ id: 'design-9' }] })
    );
    expect(file.minimumReaderSchemaVersion).toBe(8);
  });

  it('stays openable by older builds when it carries none', () => {
    expect(createNativeCreasePatternProjectFile(cpInput()).minimumReaderSchemaVersion).toBe(1);
  });

  it('carries the file-level extension bag forward', () => {
    const file = createNativeCreasePatternProjectFile(
      cpInput({ fileExtensions: { futureThing: { a: 1 } } })
    );
    expect(file.extensions).toEqual({ futureThing: { a: 1 } });
  });
});
