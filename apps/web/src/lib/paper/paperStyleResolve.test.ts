import { describe, expect, it } from 'vitest';
import { ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY } from '../oristudioCpLineStyle';
import {
  DEFAULT_LIGHT_AZIMUTH,
  DEFAULT_LIGHT_ELEVATION,
  DEFAULT_PAPER_STYLE,
  applyCreaseStyle,
  type PaperStyle,
} from './paperStyle';
import {
  PAPER_STYLE_POLICIES,
  applyPaperStylePolicy,
  hexToUnitRgb,
  lightAngles,
  lightVector,
  penDashDevicePx,
  resolvePaperStyle,
  type ResolvePaperStyleOptions,
  type Vec3,
} from './paperStyleResolve';

const OPTIONS: ResolvePaperStyleOptions = {
  dpr: 1,
  background: [0.05, 0.06, 0.07],
  backgroundAlpha: 1,
  faceAlpha: 1,
  colorMode: 'paper',
  strainClip: 5,
};

/** The light every renderer used before the style existed. */
function legacyLight(): Vec3 {
  const v = [-0.45, 0.58, 0.68];
  const length = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / length, v[1]! / length, v[2]! / length];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('lightVector', () => {
  it('pins the default angles to the legacy direction within 1e-6', () => {
    expect(
      distance(lightVector(DEFAULT_LIGHT_AZIMUTH, DEFAULT_LIGHT_ELEVATION), legacyLight())
    ).toBeLessThan(1e-6);
  });

  it('reads azimuth clockwise from straight up and elevation out of the screen', () => {
    expect(distance(lightVector(0, 0), [0, 1, 0])).toBeLessThan(1e-12);
    expect(distance(lightVector(90, 0), [1, 0, 0])).toBeLessThan(1e-12);
    expect(distance(lightVector(180, 0), [0, -1, 0])).toBeLessThan(1e-12);
    expect(distance(lightVector(45, 90), [0, 0, 1])).toBeLessThan(1e-12);
  });

  it('is unit length and inverts through lightAngles', () => {
    for (const [azimuth, elevation] of [
      [0, 0],
      [322.19347, 42.80915],
      [200, -20],
      [359, 89],
    ] as const) {
      const vector = lightVector(azimuth, elevation);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 12);
      const angles = lightAngles(vector);
      expect(angles.azimuth).toBeCloseTo(azimuth, 9);
      expect(angles.elevation).toBeCloseTo(elevation, 9);
    }
  });
});

describe('resolvePaperStyle', () => {
  it('produces today’s simulator numbers for the defaults', () => {
    const settings = resolvePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    expect(settings.creaseWidthPx).toBeCloseTo(1.1, 12);
    expect(settings.borderColor).toEqual([0, 0, 0]);
    expect(settings.frontColor).toEqual(hexToUnitRgb('#ffff32'));
    expect(settings.backColor).toEqual(hexToUnitRgb('#e9e9e9'));
    expect(settings.mountainColor).toEqual(hexToUnitRgb('#db1f24'));
    expect(settings.valleyColor).toEqual(hexToUnitRgb('#1c5cd9'));
    expect(distance(settings.lightDir, legacyLight())).toBeLessThan(1e-6);
    expect(settings.lighting).toBe(true);
    expect(settings.creaseDash).toBeUndefined();
    expect(settings.showFaces).toBe(true);
    expect(settings.showEdges).toBe(true);
    expect(settings.background).toBe(OPTIONS.background);
    expect(settings.faceAlpha).toBe(1);
    expect(settings.colorMode).toBe('paper');
    expect(settings.strainClip).toBe(5);
  });

  it('scales the crease width with the device pixel ratio', () => {
    const settings = resolvePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.simulator, {
      ...OPTIONS,
      dpr: 2,
    });
    expect(settings.creaseWidthPx).toBeCloseTo(2.2, 12);
  });

  it('turns a pen’s dash multiples into device-px runs', () => {
    const dashed = applyCreaseStyle(DEFAULT_PAPER_STYLE, 'mono-dashed');
    const settings = resolvePaperStyle(dashed, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    expect(settings.creaseDash).toBeDefined();
    expect(settings.creaseDash!.border).toBeNull();
    expect(settings.creaseDash!.mountain).toEqual(
      ORIEDITA_DASH_ONE_DOT.map((run) => expect.closeTo(run, 9))
    );
    expect(settings.creaseDash!.valley).toEqual(
      ORIEDITA_DASH_VALLEY.map((run) => expect.closeTo(run, 9))
    );
    // Both inks are the edge pen's.
    expect(settings.mountainColor).toEqual(settings.borderColor);
    expect(settings.valleyColor).toEqual(settings.borderColor);
    // At dpr 2 the runs double with the width.
    const retina = resolvePaperStyle(dashed, PAPER_STYLE_POLICIES.simulator, { ...OPTIONS, dpr: 2 });
    expect(retina.creaseDash!.valley).toEqual(
      ORIEDITA_DASH_VALLEY.map((run) => expect.closeTo(run * 2, 9))
    );
  });

  it('keeps a dashed edge pen as the border dash', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { width: 0.75, color: '#000000', dash: [1, 2], cap: 'round' },
    };
    const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    expect(settings.creaseDash!.border).toEqual([1, 2]);
    expect(penDashDevicePx(style.edges, 2)).toEqual([2, 4]);
  });

  it('never lights the flat figure, whatever the style says', () => {
    const lit = { ...DEFAULT_PAPER_STYLE, light: { enabled: true, azimuth: 0, elevation: 45 } };
    const settings = resolvePaperStyle(lit, PAPER_STYLE_POLICIES['folded-flat'], OPTIONS);
    expect(settings.lighting).toBe(false);
    // The direction is still data, and the default one: the field is not applied.
    expect(distance(settings.lightDir, legacyLight())).toBeLessThan(1e-6);
  });

  it('draws a folded figure’s creases with the edge pen', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { width: 1.5, color: '#336699', dash: null, cap: 'butt' },
      mountainFolds: { width: 0.3, color: '#ff0000', dash: [4, 2], cap: 'butt' },
    };
    for (const surface of ['folded-3d', 'folded-flat'] as const) {
      const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES[surface], OPTIONS);
      expect(settings.creaseWidthPx).toBeCloseTo(2, 12);
      expect(settings.mountainColor).toEqual(hexToUnitRgb('#336699'));
      expect(settings.valleyColor).toEqual(hexToUnitRgb('#336699'));
      expect(settings.creaseDash).toBeUndefined();
    }
  });

  it('honours a switched-off light on a lit surface', () => {
    const dark = { ...DEFAULT_PAPER_STYLE, light: { ...DEFAULT_PAPER_STYLE.light, enabled: false } };
    expect(resolvePaperStyle(dark, PAPER_STYLE_POLICIES['folded-3d'], OPTIONS).lighting).toBe(false);
    expect(resolvePaperStyle(dark, PAPER_STYLE_POLICIES.simulator, OPTIONS).lighting).toBe(false);
  });

  it('passes the surface options through', () => {
    const settings = resolvePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES['inline-simulation'], {
      ...OPTIONS,
      backgroundAlpha: 0,
      faceAlpha: 0.48,
      colorMode: 'strain',
      showFaces: false,
      showEdges: false,
      creaseWidthReferenceEdge: 320,
      creaseWidthShrinkExponent: 0.5,
    });
    expect(settings.backgroundAlpha).toBe(0);
    expect(settings.faceAlpha).toBe(0.48);
    expect(settings.colorMode).toBe('strain');
    expect(settings.showFaces).toBe(false);
    expect(settings.showEdges).toBe(false);
    expect(settings.creaseWidthReferenceEdge).toBe(320);
    expect(settings.creaseWidthShrinkExponent).toBe(0.5);
  });

  it('floors a hairline pen so it does not vanish', () => {
    const hairline: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 0.1 },
    };
    expect(
      resolvePaperStyle(hairline, PAPER_STYLE_POLICIES.simulator, OPTIONS).creaseWidthPx
    ).toBe(0.5);
  });
});

describe('applyPaperStylePolicy', () => {
  it('keeps applied fields, defaults the rest, and forces what the policy forces', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      paper: { front: '#ffffff', back: '#000000' },
      arrows: { width: 2, color: '#ff00ff', dash: null, cap: 'round' },
      erode: 0.1,
    };
    const seen = applyPaperStylePolicy(style, {
      surface: 'references',
      applies: ['arrows'],
      forced: { erode: 0.05 },
    });
    expect(seen.arrows).toEqual(style.arrows);
    expect(seen.paper).toEqual(DEFAULT_PAPER_STYLE.paper);
    expect(seen.erode).toBe(0.05);
  });

  it('lists the Phase 1 fields per surface', () => {
    expect(PAPER_STYLE_POLICIES.references.applies).not.toContain('light');
    // D13: References fills its sheet with the style's paper, both faces.
    expect(PAPER_STYLE_POLICIES.references.applies).toContain('paper.front');
    expect(PAPER_STYLE_POLICIES.references.applies).toContain('paper.back');
    expect(PAPER_STYLE_POLICIES.references.applies).toContain('arrows');
    for (const surface of ['simulator', 'inline-simulation', 'folded-3d', 'folded-flat'] as const) {
      expect(PAPER_STYLE_POLICIES[surface].applies).not.toContain('arrows');
      expect(PAPER_STYLE_POLICIES[surface].applies).toContain('edges');
      expect(PAPER_STYLE_POLICIES[surface].surface).toBe(surface);
    }
    expect(PAPER_STYLE_POLICIES['folded-flat'].applies).not.toContain('light');
  });
});

describe('hexToUnitRgb', () => {
  it('reads #rrggbb into 0..1 channels', () => {
    expect(hexToUnitRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToUnitRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToUnitRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });
});
