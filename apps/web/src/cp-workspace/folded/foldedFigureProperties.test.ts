import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import type { PropertyField, PropertySheet } from '../../lib/propertyDescriptors';
import { FIGURE } from '../canvasObjects/canvasObjectKinds.fixtures';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from './foldedFigure3dProjection';
import { buildFoldedFigureProperties, type FoldedFigurePropertyDeps } from './foldedFigureProperties';

// Identity `t`, with the one interpolation the subtitle uses.
const t = ((_key: string, fallback: string | { count?: number }, options?: { count?: number }) =>
  typeof fallback === 'string'
    ? fallback.replace('{{count}}', String(options?.count ?? ''))
    : '') as unknown as TFunction;

const MODEL = {
  state: 'Front0',
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  display_shadows: false,
  anti_alias: true,
} as unknown as NonNullable<OristudioCpFoldedFigureEntry['snapshot']>['model'];

const FLAT: OristudioCpFoldedFigureEntry = {
  ...FIGURE,
  title: 'Folded model 1',
  status: 'ready',
  handle: 3,
  snapshot: {
    model: MODEL,
    find_another_overlap_valid: true,
    discovered_fold_cases: 3,
    current_fold_case: 2,
  } as OristudioCpFoldedFigureEntry['snapshot'],
  placement: { offset: { x: 0, y: 0 }, scale: 1.5, rotation: Math.PI / 2 },
};

const SPATIAL: OristudioCpFoldedFigureEntry = {
  ...FIGURE,
  id: 'figure-3d',
  title: 'Folded model 2',
  status: 'ready',
  handle: 4,
  snapshot: null,
  folded3d: {
    model: MODEL,
    verdict: { verdict: 'folded' },
    current_fold_case: 1,
    discovered_fold_cases: 1,
  } as unknown as OristudioCpFoldedFigureEntry['folded3d'],
  camera: { yaw: Math.PI / 2, pitch: -0.5, zoom: 2, orient: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
};

function deps(
  overrides: Partial<FoldedFigurePropertyDeps> = {},
  camera: FoldedFigureCamera = SPATIAL.camera as FoldedFigureCamera
): FoldedFigurePropertyDeps {
  return {
    t,
    stale: false,
    held: false,
    begin: vi.fn(() => true),
    end: vi.fn(),
    writeModel: vi.fn(),
    commitModel: vi.fn(),
    setDisplayStyle: vi.fn(),
    setCamera: vi.fn(),
    liveCamera: { read: () => camera, subscribe: () => () => {} },
    setPlacement: vi.fn(),
    ...overrides,
  };
}

function sheetFor(figure: OristudioCpFoldedFigureEntry, d = deps()): PropertySheet {
  return buildFoldedFigureProperties({ kind: 'folded-figure', id: figure.id, figure }, d);
}

function field(sheet: PropertySheet, id: string): PropertyField {
  const found = sheet.sections.flatMap((section) => section.fields).find((f) => f.id === id);
  if (!found) throw new Error(`no field ${id}`);
  return found;
}

const visibleIds = (sheet: PropertySheet) =>
  sheet.sections.flatMap((s) => s.fields.filter((f) => f.support !== 'not-applicable').map((f) => f.id));

describe('buildFoldedFigureProperties', () => {
  it('titles the sheet with the figure and its case note, or Stale', () => {
    expect(sheetFor(FLAT)).toMatchObject({
      kind: 'folded-figure',
      targetId: FLAT.id,
      title: 'Folded model 1',
      subtitle: 'Case 2',
      icon: 'folded-figure',
    });
    expect(sheetFor(FLAT, deps({ stale: true })).subtitle).toBe('Stale');
  });

  it('offers a flat figure appearance and placement, and no camera', () => {
    const sheet = sheetFor(FLAT);
    expect(sheet.sections.map((s) => s.id)).toEqual(['appearance', 'placement']);
    expect(visibleIds(sheet)).toEqual([
      'displayStyle',
      'side',
      'frontColor',
      'backColor',
      'lineColor',
      'shadows',
      'antiAlias',
      'scale',
      'rotation',
    ]);
    for (const f of sheet.sections.flatMap((s) => s.fields)) {
      expect(f.support, f.id).toBe('supported');
    }
  });

  it('hides the side and disables shadows with a reason on a 3D figure, and adds the camera', () => {
    const sheet = sheetFor(SPATIAL);
    expect(sheet.sections.map((s) => s.id)).toEqual(['appearance', 'camera', 'placement']);
    expect(field(sheet, 'side').support).toBe('not-applicable');
    expect(visibleIds(sheet)).not.toContain('side');
    expect(field(sheet, 'shadows')).toMatchObject({
      support: 'unsupported',
      reason: 'Shadows are not drawn for a 3D folded model yet',
    });
    expect(field(sheet, 'frontColor').support).toBe('supported');
    expect(field(sheet, 'antiAlias').support).toBe('supported');
  });

  it('disables every appearance field with the Refold reason on a figure that is not ready', () => {
    const sheet = sheetFor(FIGURE);
    const appearance = sheet.sections.find((s) => s.id === 'appearance');
    for (const f of appearance?.fields ?? []) {
      if (f.support === 'not-applicable') continue;
      expect(f.support, f.id).toBe('unsupported');
      expect(f.reason, f.id).toBe('Refold to change how this figure looks');
    }
    // Placement is where the figure sits, and moving a reopened figure is fine.
    expect(field(sheet, 'scale').support).toBe('supported');
    expect(sheet.subtitle).toBe('Folding…');
  });

  it('routes the discrete appearance fields through one-entry setters', () => {
    const d = deps();
    const sheet = sheetFor(FLAT, d);
    const style = field(sheet, 'displayStyle');
    if (style.kind !== 'select') throw new Error('select');
    expect(style.options.map((o) => o.label)).toEqual(['Paper', 'X-ray', 'Wireframe']);
    style.commit('Wire2');
    expect(d.setDisplayStyle).toHaveBeenCalledWith('Wire2');

    const side = field(sheet, 'side');
    if (side.kind !== 'segmented') throw new Error('segmented');
    expect(side.value).toBe('Front0');
    expect(side.options.map((o) => o.label)).toEqual(['Front', 'Back']);
    side.commit('Back1');
    expect(d.commitModel).toHaveBeenCalledWith({ state: 'Back1' });

    const shadows = field(sheet, 'shadows');
    if (shadows.kind !== 'toggle') throw new Error('toggle');
    shadows.commit(true);
    expect(d.commitModel).toHaveBeenCalledWith({ display_shadows: true });

    const antiAlias = field(sheet, 'antiAlias');
    if (antiAlias.kind !== 'toggle') throw new Error('toggle');
    expect(antiAlias.value).toBe(true);
    antiAlias.commit(false);
    expect(d.commitModel).toHaveBeenCalledWith({ anti_alias: false });
  });

  it('marks neither side current for a figure in an overlay state', () => {
    const overlay = {
      ...FLAT,
      snapshot: { ...FLAT.snapshot, model: { ...MODEL, state: 'Both2' } },
    } as OristudioCpFoldedFigureEntry;
    const side = field(sheetFor(overlay), 'side');
    expect(side.kind === 'segmented' && side.value).toBeNull();
  });

  it('runs a colour pick as begin once, queued writes, end once', () => {
    const d = deps();
    const front = field(sheetFor(FLAT, d), 'frontColor');
    if (front.kind !== 'color') throw new Error('color');
    expect(front.value).toBe('#ffff32');
    expect(front.held).toBe(false);
    expect(front.begin()).toBe(true);
    expect(d.begin).toHaveBeenCalledWith('frontColor');
    front.update('#ff0000');
    expect(d.writeModel).toHaveBeenCalledWith({ front_color: { red: 255, green: 0, blue: 0 } });
    front.end();
    expect(d.end).toHaveBeenCalledWith('Change folded model color');
    expect(d.commitModel).not.toHaveBeenCalled();
  });

  it('reports the layer as held on every colour row', () => {
    const sheet = sheetFor(FLAT, deps({ held: true }));
    for (const id of ['frontColor', 'backColor', 'lineColor']) {
      const f = field(sheet, id);
      expect(f.kind === 'color' && f.held).toBe(true);
    }
  });

  it('edits the camera in degrees over the live camera, keeping orient', () => {
    const d = deps();
    const sheet = sheetFor(SPATIAL, d);
    const yaw = field(sheet, 'yaw');
    if (yaw.kind !== 'number') throw new Error('number');
    expect(yaw.value).toBe(90);
    expect(yaw.live?.read()).toBe(90);
    expect(yaw.suffix).toBe('°');
    yaw.commit(180);
    expect(d.setCamera).toHaveBeenCalledWith({
      yaw: Math.PI,
      pitch: -0.5,
      zoom: 2,
      orient: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });

    const pitch = field(sheet, 'pitch');
    if (pitch.kind !== 'number') throw new Error('number');
    expect(pitch.value).toBeCloseTo(-28.65, 1);
  });

  it('resets one camera axis to the fold view and leaves the rest', () => {
    const d = deps();
    const yaw = field(sheetFor(SPATIAL, d), 'yaw');
    yaw.reset?.();
    expect(d.setCamera).toHaveBeenCalledWith({
      yaw: DEFAULT_FOLDED_3D_CAMERA.yaw,
      pitch: -0.5,
      zoom: 2,
      orient: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
  });

  it('clamps zoom to the simulator range', () => {
    const d = deps();
    const zoom = field(sheetFor(SPATIAL, d), 'zoom');
    if (zoom.kind !== 'number') throw new Error('number');
    expect(zoom).toMatchObject({ min: 0.45, max: 4, step: 0.05, value: 2 });
    expect(zoom.normalize?.(9)).toBe(4);
    zoom.commit(0.1);
    expect(d.setCamera).toHaveBeenCalledWith(expect.objectContaining({ zoom: 0.45 }));
    zoom.reset?.();
    expect(d.setCamera).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 1 }));
  });

  it('reads the camera live while a drag turns the figure', () => {
    let camera: FoldedFigureCamera = { yaw: 0, pitch: 0, zoom: 1 };
    const listeners = new Set<() => void>();
    const d = deps(
      {
        liveCamera: {
          read: () => camera,
          subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
      camera
    );
    const yaw = field(sheetFor(SPATIAL, d), 'yaw');
    if (yaw.kind !== 'number') throw new Error('number');
    camera = { yaw: Math.PI / 4, pitch: 0, zoom: 1 };
    expect(yaw.live?.read()).toBe(45);
    // A commit mid-drag writes over the live frame, not the stored camera.
    yaw.commit(10);
    expect(d.setCamera).toHaveBeenCalledWith(expect.objectContaining({ pitch: 0, zoom: 1 }));
  });

  it('edits placement in the canvas gesture’s own terms', () => {
    const d = deps();
    const sheet = sheetFor(FLAT, d);
    const scale = field(sheet, 'scale');
    if (scale.kind !== 'number') throw new Error('number');
    expect(scale.value).toBe(1.5);
    scale.commit(0);
    expect(d.setPlacement).toHaveBeenCalledWith({ scale: 0.05 }, 'Resize folded form');

    const rotation = field(sheet, 'rotation');
    if (rotation.kind !== 'number') throw new Error('number');
    expect(rotation.value).toBe(90);
    rotation.commit(-45);
    const [patch, label] = (d.setPlacement as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [
      { rotation: number },
      string,
    ];
    expect(patch.rotation).toBeCloseTo(-Math.PI / 4);
    expect(label).toBe('Rotate folded form');
  });
});
