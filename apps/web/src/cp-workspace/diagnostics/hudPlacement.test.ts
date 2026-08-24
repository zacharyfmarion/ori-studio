import { describe, expect, it } from 'vitest';
import { CP_HUD_LANE_GAP, cpDiagnosticHudLaneTop } from './hudPlacement';

/**
 * Boxes as the browser reports them, relative to the viewport's top-left.
 *
 * Stated rather than derived from a width, because that is how the rule receives
 * them: both boxes are sized by their content, so the same pane width gives
 * different rects for a different step prompt or headline. The pair below are the
 * two ends of the range — a strip that stops well short of the HUD, and one at
 * its `calc(100% - 24px)` cap on a narrow pane, wrapped to a second line.
 */
const DESKTOP_READOUT = { left: 12, right: 402, bottom: 36 };
const NARROW_READOUT = { left: 12, right: 808, bottom: 52 };

/** Collapsed badge, `right: --space-4` against each viewport's right edge. */
const DESKTOP_HUD = { left: 1120 - 16 - 232 };
const NARROW_HUD = { left: 820 - 16 - 232 };

describe('cpDiagnosticHudLaneTop', () => {
  it('leaves the stylesheet in charge at desktop width', () => {
    // The property that keeps the desktop appearance untouched: where the two
    // clear each other, nothing is written to the element at all.
    expect(cpDiagnosticHudLaneTop(DESKTOP_HUD, DESKTOP_READOUT)).toBeNull();
  });

  it('drops the HUD below a readout that runs under it', () => {
    // The narrow-pane case: the strip reaches past the HUD's left edge, and the
    // two used to draw through each other.
    expect(NARROW_HUD.left).toBeLessThan(NARROW_READOUT.right); // i.e. they overlap
    expect(cpDiagnosticHudLaneTop(NARROW_HUD, NARROW_READOUT)).toBe(
      NARROW_READOUT.bottom + CP_HUD_LANE_GAP
    );
  });

  it('drops the HUD for a readout that merely touches its clearance', () => {
    // A gap smaller than the lane's own is not clearance — it reads as two
    // surfaces jammed together, which is what stacking exists to avoid.
    const grazing = { ...NARROW_READOUT, right: NARROW_HUD.left - (CP_HUD_LANE_GAP - 1) };
    expect(cpDiagnosticHudLaneTop(NARROW_HUD, grazing)).toBe(grazing.bottom + CP_HUD_LANE_GAP);
  });

  it('stays in the top row once exactly the lane gap is free', () => {
    const clearing = { ...NARROW_READOUT, right: NARROW_HUD.left - CP_HUD_LANE_GAP };
    expect(cpDiagnosticHudLaneTop(NARROW_HUD, clearing)).toBeNull();
  });

  it('stays in the top row across every width from 600pt up while the strip is short', () => {
    // A one-line strip is the resting state of the readout, and it must not cost
    // the HUD a row anywhere in the supported range.
    for (let width = 600; width <= 1440; width += 20) {
      const hud = { left: width - 16 - 232 };
      const short = { left: 12, right: 12 + 220, bottom: 36 };
      expect(cpDiagnosticHudLaneTop(hud, short)).toBeNull();
    }
  });

  it('never lets the two overlap once the strip is full width', () => {
    // The same sweep with the strip at its cap: at every width the HUD is either
    // clear horizontally or placed below the strip's bottom edge.
    for (let width = 600; width <= 1440; width += 20) {
      const hud = { left: width - 16 - 232 };
      const full = { left: 12, right: width - 12, bottom: 52 };
      const top = cpDiagnosticHudLaneTop(hud, full);
      const clears = hud.left >= full.right + CP_HUD_LANE_GAP;
      expect(clears || (top !== null && top >= full.bottom)).toBe(true);
    }
  });

  it('ignores a readout that is absent', () => {
    expect(cpDiagnosticHudLaneTop(NARROW_HUD, null)).toBeNull();
    expect(cpDiagnosticHudLaneTop(NARROW_HUD, undefined)).toBeNull();
  });

  it('ignores a readout that has not been laid out', () => {
    // Every box collapses onto the origin before layout; reading that as an
    // overlap would drop the HUD a row for nothing and then snap it back.
    expect(cpDiagnosticHudLaneTop(NARROW_HUD, { left: 0, right: 0, bottom: 0 })).toBeNull();
  });
});
