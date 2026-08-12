import { describe, expect, it } from 'vitest';
import type { OristudioBpSheet } from '../engine/oristudioBpTypes';
import {
  bpPackingSheetCenter,
  bpPackingSymmetryAxis,
  isBpFlapOnAxis,
} from './bpPackingSymmetry';
import {
  bpTreePointToLayoutPoint,
  seedBpFlapAnchor,
  seedBpPartnerFlapAnchor,
} from './bpFlapSeeding';

/** The two folds, unturned — the orientation a design starts and stays in here. */
const BOOK = { fold: 'book', quarterTurn: false } as const;
const DIAGONAL = { fold: 'diagonal', quarterTurn: false } as const;

/**
 * The starter project's real sheets: a 20×20 tree and a 16×16 layout. They are
 * deliberately different sizes here for the same reason the mirror tests use two
 * sizes — a map that quietly treats tree coordinates as layout coordinates passes
 * every equal-sheet fixture.
 */
function sheet(
  width: number,
  height = width,
  kind: OristudioBpSheet['kind'] = 'rectangular'
): OristudioBpSheet {
  return { kind, width, height, grid: { kind: 'rectangular', interval: 1, snap: true } };
}

const TREE = sheet(20);
const LAYOUT = sheet(16);

describe('bpTreePointToLayoutPoint', () => {
  it('scales between the two sheets rather than copying coordinates', () => {
    // 16/20 = 0.8, and the engine rounds.
    expect(bpTreePointToLayoutPoint({ x: 10, y: 10 }, TREE, LAYOUT)).toEqual({ x: 8, y: 8 });
    expect(bpTreePointToLayoutPoint({ x: 15, y: 5 }, TREE, LAYOUT)).toEqual({ x: 12, y: 4 });
  });

  it('rounds, matching the engine', () => {
    // 11.5 * 0.8 = 9.2 -> 9
    expect(bpTreePointToLayoutPoint({ x: 11.5, y: 11 }, TREE, LAYOUT)).toEqual({ x: 9, y: 9 });
    // 8.5 * 0.8 = 6.8 -> 7
    expect(bpTreePointToLayoutPoint({ x: 8.5, y: 11 }, TREE, LAYOUT)).toEqual({ x: 7, y: 9 });
  });

  it('constrains onto the layout sheet', () => {
    expect(bpTreePointToLayoutPoint({ x: 40, y: -5 }, TREE, LAYOUT)).toEqual({ x: 16, y: 0 });
  });

  it('is the identity when the sheets match', () => {
    expect(bpTreePointToLayoutPoint({ x: 6, y: 3 }, LAYOUT, LAYOUT)).toEqual({ x: 6, y: 3 });
  });
});

describe('seedBpFlapAnchor', () => {
  it('puts the flap where the leaf was drawn', () => {
    expect(
      seedBpFlapAnchor({
        treeLoc: { x: 15, y: 5 },
        treeSheet: TREE,
        layoutSheet: LAYOUT,
        mirror: BOOK,
        selfMirrored: false,
      })
    ).toEqual({ x: 12, y: 4 });
  });

  it('leaves a book-fold centre leaf alone: the map already centres it', () => {
    expect(
      seedBpFlapAnchor({
        treeLoc: { x: 10, y: 6 },
        treeSheet: TREE,
        layoutSheet: LAYOUT,
        mirror: BOOK,
        selfMirrored: true,
      })
      // 10 * 0.8 = 8, dead centre of a 16-wide sheet; 6 * 0.8 = 4.8 -> 5.
    ).toEqual({ x: 8, y: 5 });
  });

  it('projects a self-mirrored leaf onto the paper axis under a diagonal fold', () => {
    // The tree's mirror is vertical whatever the fold, so mapping a centre leaf
    // lands it on the layout's vertical middle — which is not the diagonal the
    // paper is folded about.
    const anchor = seedBpFlapAnchor({
      treeLoc: { x: 10, y: 5 },
      treeSheet: TREE,
      layoutSheet: LAYOUT,
      mirror: DIAGONAL,
      selfMirrored: true,
    });
    const axis = bpPackingSymmetryAxis(LAYOUT, DIAGONAL);
    expect(isBpFlapOnAxis(anchor, { width: 0, height: 0 }, bpPackingSheetCenter(LAYOUT), axis)).toBe(
      true
    );
  });

  it('does not project when mirror draw is off', () => {
    expect(
      seedBpFlapAnchor({
        treeLoc: { x: 10, y: 5 },
        treeSheet: TREE,
        layoutSheet: LAYOUT,
        mirror: null,
        selfMirrored: true,
      })
    ).toEqual({ x: 8, y: 4 });
  });
});

describe('seedBpPartnerFlapAnchor', () => {
  it('reflects the primary about the layout sheet centre', () => {
    expect(seedBpPartnerFlapAnchor({ x: 9, y: 9 }, LAYOUT, BOOK)).toEqual({ x: 7, y: 9 });
  });

  it('is symmetric by construction, not by rounding luck', () => {
    // Two tree positions that are exact mirrors about x = 10 whose independent
    // maps do NOT come out as mirrors: 11.25*0.8 = 9 and 8.75*0.8 = 7, which do
    // pair — but 11.4 -> 9 and 8.6 -> 7 only by chance. Deriving the partner from
    // the primary makes the pair exact whatever the map rounded to.
    for (const x of [9, 10, 11, 12, 13]) {
      const partner = seedBpPartnerFlapAnchor({ x, y: 4 }, LAYOUT, BOOK);
      expect(partner && partner.x + x).toBe(16);
    }
  });

  it('swaps the coordinates under a diagonal fold', () => {
    expect(seedBpPartnerFlapAnchor({ x: 3, y: 11 }, LAYOUT, DIAGONAL)).toEqual({ x: 11, y: 3 });
  });

  it('declines when the fold has no mirror on this sheet', () => {
    expect(seedBpPartnerFlapAnchor({ x: 3, y: 11 }, sheet(16, 10), DIAGONAL)).toBeNull();
  });
});
