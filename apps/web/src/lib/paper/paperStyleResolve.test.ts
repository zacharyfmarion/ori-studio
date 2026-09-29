import { describe, expect, it } from 'vitest';
import { ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_VALLEY } from '../oristudioCpLineStyle';
import { widestPenPt } from './paperSvg';
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
  surfacePaperStyle,
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
  // Re-pinned: the Default preset now draws a simulation's folds as edges,
  // and dashes them as a diagram does when they are drawn by direction.
  it('produces the simulator’s numbers for the defaults', () => {
    const settings = resolvePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    // Re-pinned for X14: every line used to draw at the folds' 1.1 px. The
    // edge is its own pen now, 0.9 pt, and the folds as edges are the average
    // of the two fold pens, both 0.825 pt.
    expect(settings.edgeWidthPx).toBeCloseTo(1.2, 12);
    expect(settings.mountainWidthPx).toBeCloseTo(1.1, 12);
    expect(settings.valleyWidthPx).toBeCloseTo(1.1, 12);
    expect(settings.borderColor).toEqual([0, 0, 0]);
    expect(settings.frontColor).toEqual(hexToUnitRgb('#ffff32'));
    expect(settings.backColor).toEqual(hexToUnitRgb('#e9e9e9'));
    // Every fold in the edge pen, solid.
    expect(settings.mountainColor).toEqual([0, 0, 0]);
    expect(settings.valleyColor).toEqual([0, 0, 0]);
    expect(distance(settings.lightDir, legacyLight())).toBeLessThan(1e-6);
    expect(settings.lighting).toBe(true);
    expect(settings.creaseDash).toBeUndefined();
    expect(settings.showFaces).toBe(true);
    expect(settings.showEdges).toBe(true);
    expect(settings.background).toBe(OPTIONS.background);
    expect(settings.faceAlpha).toBe(1);
    expect(settings.colorMode).toBe('paper');
    expect(settings.strainClip).toBe(5);

    // By direction: the convention inks, dash-dot and dashed at the 1.1 px pen.
    const byDirection = resolvePaperStyle(
      { ...DEFAULT_PAPER_STYLE, foldsAsEdges: false },
      PAPER_STYLE_POLICIES.simulator,
      OPTIONS
    );
    expect(byDirection.mountainColor).toEqual(hexToUnitRgb('#db1f24'));
    expect(byDirection.valleyColor).toEqual(hexToUnitRgb('#1c5cd9'));
    expect(byDirection.creaseDash?.mountain).toEqual(
      [8.8, 2.2, 1.1, 2.2].map((run) => expect.closeTo(run, 9))
    );
    expect(byDirection.creaseDash?.valley).toEqual([4.4, 2.2].map((run) => expect.closeTo(run, 9)));
    expect(byDirection.creaseDash?.border).toBeNull();
  });

  it('scales every line width with the device pixel ratio', () => {
    const settings = resolvePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.simulator, {
      ...OPTIONS,
      dpr: 2,
    });
    expect(settings.edgeWidthPx).toBeCloseTo(2.4, 12);
    expect(settings.mountainWidthPx).toBeCloseTo(2.2, 12);
    expect(settings.valleyWidthPx).toBeCloseTo(2.2, 12);
  });

  it('turns a pen’s dash multiples into device-px runs', () => {
    const dashed = applyCreaseStyle({ ...DEFAULT_PAPER_STYLE, foldsAsEdges: false }, 'mono-dashed');
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
    // Re-pinned back for X14: the runs are multiples of the width the edge is
    // drawn at, which on the simulator is the edge pen's own again, 1 px.
    expect(settings.edgeWidthPx).toBeCloseTo(1, 12);
    expect(settings.creaseDash!.border).toEqual([1, 2].map((run) => expect.closeTo(run, 9)));
    expect(penDashDevicePx(style.edges, 2)).toEqual([2, 4]);
  });

  it('never lights the flat figure, whatever the style says', () => {
    const lit = { ...DEFAULT_PAPER_STYLE, light: { enabled: true, azimuth: 0, elevation: 45 } };
    const settings = resolvePaperStyle(lit, PAPER_STYLE_POLICIES['folded-flat'], OPTIONS);
    expect(settings.lighting).toBe(false);
    // The direction is still data, and the default one: the field is not applied.
    expect(distance(settings.lightDir, legacyLight())).toBeLessThan(1e-6);
  });

  it('draws the flat figure’s creases with the edge pen', () => {
    // Re-pinned: this held for the 3D figure too until Phase 5 gave its policy
    // the fold pens; the flat figure has no visible M/V (D6) and keeps it.
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { width: 1.5, color: '#336699', dash: null, cap: 'butt' },
      mountainFolds: { width: 0.3, color: '#ff0000', dash: [4, 2], cap: 'butt' },
    };
    const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES['folded-flat'], OPTIONS);
    expect(settings.edgeWidthPx).toBeCloseTo(2, 12);
    expect(settings.mountainWidthPx).toBeCloseTo(2, 12);
    expect(settings.valleyWidthPx).toBeCloseTo(2, 12);
    expect(settings.mountainColor).toEqual(hexToUnitRgb('#336699'));
    expect(settings.valleyColor).toEqual(hexToUnitRgb('#336699'));
    expect(settings.creaseDash).toBeUndefined();
  });

  // Phase 9: a fold that has happened is an edge of the paper, so a folded
  // figure draws every fold in the edge pen, the 3D figure as the flat one.
  it('draws the 3D figure’s folds in the edge pen, as the flat figure does', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { width: 1.5, color: '#336699', dash: null, cap: 'butt' },
      mountainFolds: { width: 0.3, color: '#ff0000', dash: [4, 2], cap: 'butt' },
    };
    const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES['folded-3d'], OPTIONS);
    // Every fold is the edge pen, width included, as the border is.
    expect(settings.edgeWidthPx).toBeCloseTo(2, 12);
    expect(settings.mountainWidthPx).toBeCloseTo(2, 12);
    expect(settings.valleyWidthPx).toBeCloseTo(2, 12);
    expect(settings.mountainColor).toEqual(hexToUnitRgb('#336699'));
    expect(settings.valleyColor).toEqual(hexToUnitRgb('#336699'));
    expect(settings.borderColor).toEqual(hexToUnitRgb('#336699'));
    expect(settings.creaseDash).toBeUndefined();
  });

  // A simulation draws by direction unless its style says otherwise; then its
  // folds take the edge pen's ink at the average of the fold pens' widths.
  it('draws a simulation’s folds by direction, or as edges when the style says so', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      edges: { width: 1.5, color: '#336699', dash: null, cap: 'butt' },
      mountainFolds: { width: 0.75, color: '#ff0000', dash: [4, 2], cap: 'butt' },
      foldsAsEdges: false,
    };
    for (const surface of ['simulator', 'inline-simulation'] as const) {
      const byDirection = resolvePaperStyle(style, PAPER_STYLE_POLICIES[surface], OPTIONS);
      expect(byDirection.mountainColor, surface).toEqual(hexToUnitRgb('#ff0000'));
      // Re-pinned for X14: each line at its own pen's width, where every line
      // used to draw at the mountain pen's 1 px.
      expect(byDirection.edgeWidthPx, surface).toBeCloseTo(2, 12);
      expect(byDirection.mountainWidthPx, surface).toBeCloseTo(1, 12);
      expect(byDirection.valleyWidthPx, surface).toBeCloseTo(1.1, 12);
      const asEdges = resolvePaperStyle(
        { ...style, foldsAsEdges: true },
        PAPER_STYLE_POLICIES[surface],
        OPTIONS
      );
      expect(asEdges.mountainColor, surface).toEqual(hexToUnitRgb('#336699'));
      expect(asEdges.valleyColor, surface).toEqual(hexToUnitRgb('#336699'));
      expect(asEdges.creaseDash, surface).toBeUndefined();
      // The paper's edge is the edge pen exactly; the folds are the average
      // of the two fold pens, (0.75 + 0.825) / 2 pt = 1.05 px.
      expect(asEdges.edgeWidthPx, surface).toBeCloseTo(2, 12);
      expect(asEdges.mountainWidthPx, surface).toBeCloseTo(1.05, 12);
      expect(asEdges.valleyWidthPx, surface).toBeCloseTo(1.05, 12);
    }
    // A surface that does not read the switch is not moved by it.
    const references = surfacePaperStyle(
      { ...style, foldsAsEdges: true },
      PAPER_STYLE_POLICIES.references
    );
    expect(references.mountainFolds.color).toBe('#ff0000');
  });

  it('resolves the aux pen at its own width and dash, shown only when the style shows it', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      auxCreases: {
        visible: true,
        pen: { width: 0.375, color: '#00ff00', dash: [1, 2], cap: 'butt' },
      },
      erode: 0.02,
    };
    for (const surface of ['simulator', 'folded-3d', 'folded-flat', 'references'] as const) {
      const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES[surface], OPTIONS);
      expect(settings.showAux, surface).toBe(true);
      expect(settings.auxColor, surface).toEqual([0, 1, 0]);
      expect(settings.auxWidthPx, surface).toBeCloseTo(0.5, 12);
      expect(settings.creaseDash?.aux, surface).toEqual([0.5, 1].map((run) => expect.closeTo(run, 9)));
      expect(settings.erode, surface).toBe(0.02);
    }
    const hidden = resolvePaperStyle(
      { ...style, auxCreases: { ...style.auxCreases, visible: false } },
      PAPER_STYLE_POLICIES.simulator,
      OPTIONS
    );
    expect(hidden.showAux).toBe(false);
    // The pen is still resolved, so a toggle is a uniform rather than a rebuild.
    expect(hidden.auxColor).toEqual([0, 1, 0]);
  });

  it('floors the aux pen with the same hairline floor as the folds', () => {
    const hairline: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      auxCreases: {
        visible: true,
        pen: { ...DEFAULT_PAPER_STYLE.auxCreases.pen, width: 0.1 },
      },
    };
    expect(
      resolvePaperStyle(hairline, PAPER_STYLE_POLICIES.simulator, OPTIONS).auxWidthPx
    ).toBe(0.5);
  });

  it('crosses erode as a fraction of the sheet, not as pixels', () => {
    // The renderers scale it per frame (`erodePx`): the camera's scale lives
    // in the worker and moves with every zoom, so a device-px figure resolved
    // here would be right for one zoom only.
    const settings = resolvePaperStyle(
      { ...DEFAULT_PAPER_STYLE, erode: 0.05 },
      PAPER_STYLE_POLICIES.simulator,
      { ...OPTIONS, dpr: 2 }
    );
    expect(settings.erode).toBe(0.05);
    expect(
      resolvePaperStyle(DEFAULT_PAPER_STYLE, PAPER_STYLE_POLICIES.simulator, OPTIONS).erode
    ).toBe(0);
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
      foldsAsEdges: false,
      edges: { ...DEFAULT_PAPER_STYLE.edges, width: 0.1 },
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 0.1 },
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, width: 0.1 },
    };
    const settings = resolvePaperStyle(hairline, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    expect(settings.edgeWidthPx).toBe(0.5);
    expect(settings.mountainWidthPx).toBe(0.5);
    expect(settings.valleyWidthPx).toBe(0.5);
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

  it('lists the fields per surface', () => {
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

  it('applies the aux pen, its toggle and erode on every surface since Phase 5', () => {
    for (const policy of Object.values(PAPER_STYLE_POLICIES)) {
      for (const field of ['auxCreases.visible', 'auxCreases.pen', 'erode'] as const) {
        expect(policy.applies, `${policy.surface} ${field}`).toContain(field);
      }
    }
    // Both folded figures draw their folds as edges (D6, Phase 9): neither
    // reads the fold pens. Simulations and References do.
    for (const surface of ['folded-3d', 'folded-flat'] as const) {
      expect(PAPER_STYLE_POLICIES[surface].applies).not.toContain('mountainFolds');
      expect(PAPER_STYLE_POLICIES[surface].applies).not.toContain('valleyFolds');
    }
    expect(PAPER_STYLE_POLICIES.simulator.applies).toContain('foldsAsEdges');
    expect(PAPER_STYLE_POLICIES['inline-simulation'].applies).toContain('foldsAsEdges');
    expect(PAPER_STYLE_POLICIES.references.applies).not.toContain('foldsAsEdges');
  });

  it('applies the diagram-crease pens on References alone, the one surface that draws an instruction', () => {
    for (const field of ['mountainDiagramCreases', 'valleyDiagramCreases'] as const) {
      expect(PAPER_STYLE_POLICIES.references.applies).toContain(field);
      for (const surface of ['simulator', 'inline-simulation', 'folded-3d', 'folded-flat'] as const) {
        expect(PAPER_STYLE_POLICIES[surface].applies, `${surface} ${field}`).not.toContain(field);
      }
    }
    const pinned: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      valleyDiagramCreases: { width: 2, color: '#00ff00', dash: null, cap: 'round' },
    };
    expect(applyPaperStylePolicy(pinned, PAPER_STYLE_POLICIES.references).valleyDiagramCreases).toEqual(
      pinned.valleyDiagramCreases
    );
  });
});

describe('surfacePaperStyle', () => {
  const style: PaperStyle = {
    ...DEFAULT_PAPER_STYLE,
    edges: { ...DEFAULT_PAPER_STYLE.edges, width: 0.9, dash: [4, 2] },
    mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 3 },
    valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, width: 0.5 },
    // By direction, so each fold pen keeps its own ink and dash.
    foldsAsEdges: false,
  };

  // Re-pinned for X14: every pen used to take the mountain pen's width, the
  // one width the screen could draw; the screen draws each pen's own now.
  it('draws every simulator pen as it is, width included', () => {
    for (const policy of [PAPER_STYLE_POLICIES.simulator, PAPER_STYLE_POLICIES['inline-simulation']]) {
      const seen = surfacePaperStyle(style, policy);
      expect(seen.edges, policy.surface).toEqual(style.edges);
      expect(seen.mountainFolds, policy.surface).toEqual(style.mountainFolds);
      expect(seen.valleyFolds, policy.surface).toEqual(style.valleyFolds);
    }
    const settings = resolvePaperStyle(style, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    expect(settings.edgeWidthPx).toBeCloseTo(0.9 * (4 / 3), 12);
    expect(settings.mountainWidthPx).toBeCloseTo(3 * (4 / 3), 12);
    expect(settings.valleyWidthPx).toBeCloseTo(0.5 * (4 / 3), 12);
  });

  it('hands References each pen as it is, as its view draws them', () => {
    const instructed: PaperStyle = {
      ...style,
      mountainDiagramCreases: { ...style.mountainDiagramCreases, width: 1.5, color: '#00aa00' },
      valleyDiagramCreases: { ...style.valleyDiagramCreases, width: 0.4, color: '#00bb00' },
    };
    const seen = surfacePaperStyle(instructed, PAPER_STYLE_POLICIES.references);
    expect(seen.edges).toEqual(style.edges);
    expect(seen.mountainFolds).toEqual(style.mountainFolds);
    expect(seen.valleyFolds).toEqual(style.valleyFolds);
    expect(seen.mountainDiagramCreases).toEqual(instructed.mountainDiagramCreases);
    expect(seen.valleyDiagramCreases).toEqual(instructed.valleyDiagramCreases);
  });

  it('gives a surface that draws no instruction its fold pens as diagram creases, so they widen nothing', () => {
    // Left at their defaults they would be a pen the surface never draws, and
    // the widest pen — its hidden test's ink allowance and its page's margin —
    // would count it: the Diagram preset's 0.5 pt edge would measure 0.825 pt.
    const thin: PaperStyle = {
      ...style,
      edges: { ...style.edges, width: 0.3 },
      mountainFolds: { ...style.mountainFolds, width: 0.2 },
      valleyFolds: { ...style.valleyFolds, width: 0.2 },
      auxCreases: { visible: true, pen: { ...style.auxCreases.pen, width: 0.1 } },
    };
    for (const surface of ['simulator', 'inline-simulation', 'folded-3d', 'folded-flat'] as const) {
      const seen = surfacePaperStyle(thin, PAPER_STYLE_POLICIES[surface]);
      expect(seen.mountainDiagramCreases, surface).toEqual(seen.mountainFolds);
      expect(seen.valleyDiagramCreases, surface).toEqual(seen.valleyFolds);
      expect(widestPenPt(seen), surface).toBeCloseTo(0.3, 12);
    }
  });

  it('gives the flat figure the edge pen for every crease', () => {
    // Re-pinned from "a folded figure": the 3D figure's policy applied the
    // fold pens from Phase 5 until Phase 9 drew its folds as edges again.
    const seen = surfacePaperStyle(style, PAPER_STYLE_POLICIES['folded-flat']);
    expect(seen.mountainFolds).toEqual(style.edges);
    expect(seen.valleyFolds).toEqual(style.edges);
    expect(seen.edges).toEqual(style.edges);
  });

  it('draws the 3D figure’s folds with the edge pen, at the edge’s width', () => {
    const seen = surfacePaperStyle(style, PAPER_STYLE_POLICIES['folded-3d']);
    expect(seen.edges).toEqual(style.edges);
    expect(seen.mountainFolds).toEqual(style.edges);
    expect(seen.valleyFolds).toEqual(style.edges);
  });

  it('draws a simulation’s folds as edges at the fold pens’ average width, its edge as the edge pen', () => {
    // Re-pinned for X14: every line used to be the edge pen at the mountain
    // pen's width. The folds are the edge pen's colour, dash and cap at the
    // average of the fold widths, (3 + 0.5) / 2; the edge is left alone.
    const asEdges = { ...style, foldsAsEdges: true };
    for (const policy of [PAPER_STYLE_POLICIES.simulator, PAPER_STYLE_POLICIES['inline-simulation']]) {
      const seen = surfacePaperStyle(asEdges, policy);
      const fold = { ...style.edges, width: 1.75 };
      expect(seen.edges, policy.surface).toEqual(style.edges);
      expect(seen.mountainFolds, policy.surface).toEqual(fold);
      expect(seen.valleyFolds, policy.surface).toEqual(fold);
    }
    const settings = resolvePaperStyle(asEdges, PAPER_STYLE_POLICIES.simulator, OPTIONS);
    expect(settings.edgeWidthPx).toBeCloseTo(0.9 * (4 / 3), 12);
    expect(settings.mountainWidthPx).toBeCloseTo(1.75 * (4 / 3), 12);
    expect(settings.valleyWidthPx).toBeCloseTo(1.75 * (4 / 3), 12);
    // The folds take the edge pen's dash, in multiples of their own width.
    expect(settings.creaseDash?.mountain).toEqual(
      [4, 2].map((run) => expect.closeTo(run * 1.75 * (4 / 3), 9))
    );
    expect(settings.creaseDash?.border).toEqual(
      [4, 2].map((run) => expect.closeTo(run * 0.9 * (4 / 3), 9))
    );
  });

  it('leaves the aux pen at its own width', () => {
    const auxed: PaperStyle = {
      ...style,
      auxCreases: { visible: true, pen: { ...style.auxCreases.pen, width: 0.25 } },
    };
    for (const policy of Object.values(PAPER_STYLE_POLICIES)) {
      expect(surfacePaperStyle(auxed, policy).auxCreases.pen.width, policy.surface).toBe(0.25);
    }
  });
});

describe('hexToUnitRgb', () => {
  it('reads #rrggbb into 0..1 channels', () => {
    expect(hexToUnitRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToUnitRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToUnitRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });
});
