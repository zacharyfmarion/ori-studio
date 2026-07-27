import { describe, expect, it } from 'vitest';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureEntry,
} from '../engine/oristudioCpTypes';
import {
  activeNativeDocument,
  createNativeBoxPleatProjectFile,
  createNativeCreasePatternProjectFile,
  createNativeProjectFile,
  createNativeTreeProjectFile,
  isNativeProjectFilename,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from './nativeProjectFile';
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
    const document = activeNativeDocument(parsed);

    expect(isNativeProjectFilename('design.osf')).toBe(true);
    expect(parsed.format).toBe('oristudio.project');
    expect(parsed.workspace.activeMode).toBe('tree');
    expect(document).toMatchObject({
      kind: 'treemaker-tree',
      title: 'Tree design',
      tree: { format: 'tmd5', text: 'tm text' },
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
    const document = activeNativeDocument(parsed);

    expect(parsed.workspace.activeMode).toBe('crease-pattern');
    expect(document.kind).toBe('crease-pattern');
    if (document.kind !== 'crease-pattern') throw new Error('expected CP document');
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
    const entry = serialized.workspace.documents[0].viewState.foldedFigures[0];
    delete entry.placement;
    entry.displayOffset = { x: 12, y: -8 };

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = activeNativeDocument(parsed);
    if (document?.kind !== 'crease-pattern') throw new Error('expected CP document');
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
    const document = activeNativeDocument(parsed);
    if (document?.kind !== 'crease-pattern') throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0]).toMatchObject({
      sourceBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      sourceFingerprint: 'fingerprint-1',
      sourceLineIds: [1, 2, 3],
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
    const entry = serialized.workspace.documents[0].viewState.foldedFigures[0];
    delete entry.sourceBounds;
    delete entry.sourceFingerprint;
    delete entry.sourceLineIds;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = activeNativeDocument(parsed);
    if (document?.kind !== 'crease-pattern') throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0]).toMatchObject({
      sourceBounds: null,
      sourceFingerprint: null,
      sourceLineIds: [],
    });
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
    serialized.workspace.documents[0].viewState.foldedFigures[0].sourceBounds = { minX: 0 };

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = activeNativeDocument(parsed);
    if (document?.kind !== 'crease-pattern') throw new Error('expected CP document');
    expect(document.viewState.foldedFigures[0].sourceBounds).toBeNull();
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
    delete serialized.workspace.documents[0].viewState.foldedFigures[0].placement;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = activeNativeDocument(parsed);
    if (document?.kind !== 'crease-pattern') throw new Error('expected CP document');
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
    serialized.workspace.documents[0].viewState.foldedFigures[0].placement.scale = 0;

    const parsed = parseNativeProjectFile(JSON.stringify(serialized));
    const document = activeNativeDocument(parsed);
    if (document?.kind !== 'crease-pattern') throw new Error('expected CP document');
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

    expect(parsed.schemaVersion).toBe(4);
    expect(parsed.workspace.documents.map((document) => document.kind)).toEqual([
      'treemaker-tree',
      'crease-pattern',
    ]);
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

    expect(parsed.workspace.activeMode).toBe('box-pleat');
    expect(parsed.workspace.activeDocumentId).toBe('box-pleat');
    expect(parsed.workspace.documents.map((document) => document.kind)).toEqual([
      'box-pleat',
      'crease-pattern',
    ]);
    const active = activeNativeDocument(parsed);
    expect(active.kind).toBe('box-pleat');
    if (active.kind !== 'box-pleat') throw new Error('expected box-pleat document');
    expect(active.project).toEqual({
      engine: 'oristudio-bp',
      format: 'bps',
      text: '{"title":"Crane","tree":{}}',
    });
  });

  it('serializes a tree design, a box-pleat design, and a crease pattern together', () => {
    const file = createNativeProjectFile({
      workspaceTitle: 'Multi',
      filename: 'multi.osf',
      path: '/tmp/multi.osf',
      activeMode: 'tree',
      tree: { title: 'Multi tree', tmd5Text: 'tmd5-body' },
      boxPleat: { title: 'Multi bp', bps: '{"tree":{}}' },
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
    expect(parsed.workspace.documents.map((document) => document.kind)).toEqual([
      'treemaker-tree',
      'box-pleat',
      'crease-pattern',
    ]);
    // activeMode selects which document is primary; here the tree.
    expect(parsed.workspace.activeMode).toBe('tree');
    expect(parsed.workspace.activeDocumentId).toBe('tree');
    expect(activeNativeDocument(parsed).kind).toBe('treemaker-tree');
  });

  it('points activeDocumentId at the box-pleat design when it is the active mode', () => {
    const file = createNativeProjectFile({
      workspaceTitle: 'Multi',
      filename: 'multi.osf',
      path: null,
      activeMode: 'box-pleat',
      tree: { title: 'Multi tree', tmd5Text: 'tmd5-body' },
      boxPleat: { title: 'Multi bp', bps: '{"tree":{}}' },
      appVersion: '0.1.1',
      now,
    });

    const parsed = parseNativeProjectFile(serializeNativeProjectFile(file));
    expect(parsed.workspace.activeDocumentId).toBe('box-pleat');
    expect(activeNativeDocument(parsed).kind).toBe('box-pleat');
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
    expect(parsed.workspace.documents.map((document) => document.kind)).toEqual(['box-pleat']);
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
    file.workspace.documents[0].project.engine = 'somethingElse';
    expect(() => parseNativeProjectFile(JSON.stringify(file))).toThrow(/Unsupported box-pleat engine/i);
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
    const legacy = JSON.parse(serializeNativeProjectFile(file));
    legacy.schemaVersion = 1;
    delete legacy.workspace.documents[0].creasePattern.lineage;

    const parsed = parseNativeProjectFile(JSON.stringify(legacy));
    const document = activeNativeDocument(parsed);

    expect(parsed.schemaVersion).toBe(4);
    expect(document.kind).toBe('crease-pattern');
    if (document.kind !== 'crease-pattern') throw new Error('expected CP document');
    expect(document.creasePattern.lineage).toMatchObject({ kind: 'imported', stale: false });
  });

  it('rejects non-project and newer required schema files', () => {
    expect(() => parseNativeProjectFile('{"format":"fold"}')).toThrow(/not an Ori Studio project/i);
    expect(() =>
      parseNativeProjectFile(
        JSON.stringify({
          format: 'oristudio.project',
          schemaVersion: 5,
          minimumReaderSchemaVersion: 5,
        })
      )
    ).toThrow(/requires reader schema 5/i);
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
    const document = activeNativeDocument(parsed);
    if (document.kind !== 'crease-pattern') throw new Error('expected CP document');
    expect(document.creasePattern.images).toEqual([image]);
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
    const legacy = JSON.parse(serializeNativeProjectFile(file));
    legacy.schemaVersion = 2;
    delete legacy.workspace.documents[0].creasePattern.images;

    const parsed = parseNativeProjectFile(JSON.stringify(legacy));
    const document = activeNativeDocument(parsed);
    if (document.kind !== 'crease-pattern') throw new Error('expected CP document');
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
    raw.workspace.documents[0].creasePattern.images = [
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
    const document = activeNativeDocument(parsed);
    if (document.kind !== 'crease-pattern') throw new Error('expected CP document');
    expect(document.creasePattern.images).toHaveLength(1);
    expect(document.creasePattern.images?.[0]?.id).toBe('good');
  });

  it('preserves file- and document-level extension bags on save (forward-compat)', () => {
    const file = createNativeProjectFile({
      workspaceTitle: 'CP',
      filename: 'ext.osf',
      path: null,
      activeMode: 'crease-pattern',
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
    const document = activeNativeDocument(parsed);
    expect(parsed.extensions).toEqual({ futureFileFeature: 'keep-me' });
    expect(document.extensions).toEqual({ futureDocFeature: { a: 1 } });
  });
});
