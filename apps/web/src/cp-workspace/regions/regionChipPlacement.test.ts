import { describe, expect, it } from 'vitest';
import {
  REGION_CHIP_BOUNDARY_PADDING,
  REGION_CHIP_GAP,
  REGION_CHIP_MIN_WIDTH,
  regionChipPlacement,
} from './regionChipPlacement';

/**
 * The title-bar rule, as arithmetic: the bar is the region's width, on the
 * region's top edge, and inside the pane.
 */

/** A 1000×600 pane at the viewport origin. */
const PANE = { left: 0, top: 0, right: 1000, bottom: 600 };

const BAR_HEIGHT = 26;

describe('regionChipPlacement', () => {
  it('takes its width and its left edge from the region, not from its own content', () => {
    const placement = regionChipPlacement(
      { left: 200, top: 300, width: 420, height: 150 },
      PANE,
      BAR_HEIGHT
    );

    // The complaint this exists to answer: a pill sized to its own controls said
    // nothing about which box it belonged to.
    expect(placement).toEqual({
      left: 200,
      top: 300 - REGION_CHIP_GAP - BAR_HEIGHT,
      width: 420,
    });
  });

  it('stays usable on a region too small to hold controls', () => {
    const placement = regionChipPlacement({ left: 100, top: 300, width: 12, height: 12 }, PANE, BAR_HEIGHT);
    // Honouring a 12 px width would make an unclickable smear of it.
    expect(placement?.width).toBe(REGION_CHIP_MIN_WIDTH);
    expect(placement?.left).toBe(100);
  });

  it('is never wider than the pane holds', () => {
    const placement = regionChipPlacement(
      { left: -400, top: 300, width: 3000, height: 3000 },
      PANE,
      BAR_HEIGHT
    );
    expect(placement?.width).toBe(1000 - REGION_CHIP_BOUNDARY_PADDING * 2);
    expect(placement?.left).toBe(REGION_CHIP_BOUNDARY_PADDING);
  });

  it('keeps the bar inside the pane rather than letting it hang off the right', () => {
    const placement = regionChipPlacement(
      { left: 900, top: 300, width: 400, height: 100 },
      PANE,
      BAR_HEIGHT
    );
    expect(placement?.left).toBe(1000 - REGION_CHIP_BOUNDARY_PADDING - 400);
  });

  it('drops inside the top edge when there is no room above it', () => {
    const placement = regionChipPlacement({ left: 200, top: 10, width: 300, height: 400 }, PANE, BAR_HEIGHT);
    // Never *below* the region: below covers what is outside it, while inside
    // overlaps only the box the user is already looking at.
    expect(placement?.top).toBe(10 + REGION_CHIP_GAP);
  });

  it('holds the bar at the pane edge when the region is zoomed past it', () => {
    // Zoomed into a region: the top edge is far off screen and the user is
    // working inside the box, which is exactly when Solve has to stay reachable.
    const placement = regionChipPlacement(
      { left: 100, top: -5000, width: 600, height: 9000 },
      PANE,
      BAR_HEIGHT
    );
    expect(placement?.top).toBe(REGION_CHIP_BOUNDARY_PADDING);
  });

  it('goes away with a region that has left the pane', () => {
    // `limitShift`'s lesson, kept: a bar that slid along the pane edge would be
    // attached to nothing on screen.
    expect(regionChipPlacement({ left: 4000, top: 300, width: 200, height: 200 }, PANE, BAR_HEIGHT)).toBeNull();
  });

  it('places the bar before its height is known without moving it far', () => {
    // The first frame runs with a height of 0; the corrected position is one
    // bar-height up, which is why the bar is hidden until it is measured.
    const unmeasured = regionChipPlacement({ left: 200, top: 300, width: 420, height: 150 }, PANE, 0);
    expect(unmeasured?.top).toBe(300 - REGION_CHIP_GAP);
    expect(unmeasured?.width).toBe(420);
  });
});
