/**
 * A 3D figure's stored picture bakes the light, so the light has to rebuild it.
 *
 * `folded3dPaperScene` shades every face against the style's light vector and
 * keeps the result as the face's `shade`; nothing downstream can re-light it,
 * because a scene carries no normals. §11's carve-out — a style change re-inks
 * the picture that is there rather than rebuilding it — is therefore true of
 * *colour* and false of the light, and these pin the split at both places a
 * light can move: the app's Paper settings and a figure's own pin.
 *
 * Without the rebuild the canvas and the `.osf` keep the shading the figure was
 * last built at while its window follows the light immediately, so the same
 * figure looks different depending on whether it happens to be windowed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperScene } from '@treemaker/origami-simulator';
import { DEFAULT_FOLDED_3D_CAMERA, folded3dFrameRadius } from '../../cp-workspace/folded/folded3dCamera';
import {
  resetFolded3dRenderModels,
  setFolded3dRenderModel,
} from '../../cp-workspace/folded/folded3dRenderModels';
import { folded3dFigureScene } from '../../cp-workspace/folded/folded3dStoredScene';
import { resetFoldedModelWriteQueueForTests } from '../../cp-workspace/folded/foldedModelWriteQueue';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
} from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../settingsStore';
import { useWorkspaceStore } from './store';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../cp-workspace/folded/__fixtures__'
);
const RENDER_MODEL: OristudioCpFolded3dRenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8')
);
const HANDLE = 5;

/** Colours that already mirror the default style, so the paper mirror has nothing to write. */
const MODEL: OristudioCpFoldedFigureModel = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

const TOLERANCES = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

function spatial(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
  const folded3d = {
    model: MODEL,
    diagnostics: { tolerances: TOLERANCES },
  } as unknown as NonNullable<OristudioCpFoldedFigureEntry['folded3d']>;
  const base = {
    id: 'spatial-1',
    title: 'Folded model 1',
    handle: HANDLE,
    sourceKind: 'generated-3d',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d,
    renderSnapshot: null,
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: DEFAULT_FOLDED_3D_CAMERA,
    frameRadius: folded3dFrameRadius(RENDER_MODEL),
    error: null,
  } as OristudioCpFoldedFigureEntry;
  return {
    ...base,
    scene: folded3dFigureScene(base, RENDER_MODEL, {
      style: DEFAULT_PAPER_STYLE,
      space: 'document',
    }),
    ...overrides,
  };
}

const stored = (): OristudioCpFoldedFigureEntry => {
  const entry = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
  if (!entry) throw new Error('expected a figure');
  return entry;
};

/** The distinct shades the picture's faces carry — every one 1 when it is unlit. */
const shades = (scene: PaperScene | null | undefined): number[] =>
  [...new Set((scene?.items ?? []).flatMap((item) => (item.kind === 'face' ? [item.shade] : [])))]
    .sort((a, b) => a - b);

const unlit = { ...DEFAULT_PAPER_STYLE.light, enabled: false };

beforeEach(() => {
  resetFoldedModelWriteQueueForTests();
  resetFolded3dRenderModels();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  setFolded3dRenderModel(HANDLE, RENDER_MODEL);
  useWorkspaceStore.setState({
    oristudioCpFoldedFigures: [spatial()],
    // The mirror answers a colour change with a kernel write; there is none here.
    updateOristudioCpFoldedFigureModel: vi.fn(async () => true) as never,
  });
});

afterEach(() => {
  resetFoldedModelWriteQueueForTests();
  resetFolded3dRenderModels();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('a 3D figure’s stored picture follows the light', () => {
  it('is shaded to begin with', () => {
    expect(shades(stored().scene).length).toBeGreaterThan(1);
  });

  it('rebuilds when the app’s light moves', () => {
    const before = stored().scene;
    useSettingsStore.getState().setPaperStyleField('display', 'light', unlit);
    expect(stored().scene).not.toBe(before);
    expect(shades(stored().scene)).toEqual([1]);
  });

  it('rebuilds when the figure pins its own light', () => {
    const before = stored().scene;
    expect(
      useWorkspaceStore.getState().setOristudioCpFoldedFigureAppearance('spatial-1', 'light', unlit)
    ).toBe(true);
    expect(stored().scene).not.toBe(before);
    expect(shades(stored().scene)).toEqual([1]);
  });

  it('leaves the picture alone for a colour change, which is only ink', () => {
    const before = stored().scene;
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#ff0000');
    expect(stored().scene).toBe(before);
    useWorkspaceStore.getState().setOristudioCpFoldedFigureAppearance('spatial-1', 'paper.back', '#0000ff');
    expect(stored().scene).toBe(before);
  });

  it('keeps a figure with no kernel as it was saved', () => {
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [spatial({ handle: null })] });
    const before = stored().scene;
    useSettingsStore.getState().setPaperStyleField('display', 'light', unlit);
    expect(stored().scene).toBe(before);
  });
});
