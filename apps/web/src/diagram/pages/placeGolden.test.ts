import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { isLockedStep, isTurn, type DiagramDocument, type DiagramStepPlace } from '../document/diagramDocument';
import { FIXTURE_FONTS, fixtureSubsetter } from '../fonts/diagramFonts.fixtures';
import type { FontSubsetter } from '../fonts/fontSubset';
import { diagramLayoutSteps, preparedPages } from './diagramPages';
import { pageLayoutFixtures } from './pageLayouts.fixtures';

/**
 * The page golden (`implementation-plans/diagram-page-overrides.md`, "Nothing
 * placed, nothing changes"): every fixture's pages, laid out and composed,
 * are the same byte for byte with no placement on any step and with one that
 * moves nothing — every offset zero; and the same as they printed before
 * placement came, held to their stored digests. What holds each new
 * expression of the layout to today's plus a zero offset, or behind a "this
 * step is placed" guard.
 */

let subsetter: FontSubsetter;
beforeAll(async () => {
  subsetter = await fixtureSubsetter();
});

const ZERO: DiagramStepPlace = { frame: [0, 0], number: [0, 0], picture: [0, 0], text: [0, 0] };

/** Every step this build reads given a placement that moves nothing, as no edit or file would keep one. */
function zeroPlaced(document: DiagramDocument): DiagramDocument {
  return {
    ...document,
    steps: document.steps.map((entry) => (isTurn(entry) || isLockedStep(entry) ? entry : { ...entry, place: ZERO })),
  };
}

/** Everything a diagram's pages print and the Pages view lays over them. */
function printed(document: DiagramDocument) {
  const pages = preparedPages(document, FIXTURE_FONTS, subsetter);
  return {
    layout: pages.layout,
    missing: pages.missing,
    pages: pages.layout.pages.map((_, index) => ({
      svg: pages.compose(index).svg,
      view: pages.compose(index, { band: false }).svg,
      arrows: pages.zoomArrows(index),
    })),
  };
}

describe('pages with nothing placed', () => {
  it.each(pageLayoutFixtures().map(({ name, document }) => [name, document] as const))(
    'are the same, byte for byte, with no placement and one of zero offsets: %s',
    (_name, document) => {
      const placed = zeroPlaced(document);
      // The layout is handed the placement, for every step this build reads.
      expect(diagramLayoutSteps(placed).filter((step) => step.place !== undefined).length).toBe(
        document.steps.filter((entry) => !isTurn(entry) && !isLockedStep(entry)).length
      );
      const plain = printed(document);
      const zero = printed(placed);
      expect(zero.layout).toEqual(plain.layout);
      expect(zero.missing).toEqual(plain.missing);
      expect(zero.pages.length).toBe(plain.pages.length);
      zero.pages.forEach((page, index) => {
        expect(page.svg).toBe(plain.pages[index]!.svg);
        expect(page.view).toBe(plain.pages[index]!.view);
        expect(page.arrows).toEqual(plain.pages[index]!.arrows);
      });
    }
  );
});

/** A text's digest: its sha256's first 16 hex digits. */
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

describe('pages as they printed before placement came', () => {
  it('are held to their digests: the page, the Pages view’s page and its arrows, page by page', () => {
    // Taken from the layout at 6f7792459 (Phase 1 changes no page). A change here
    // is a change to what every diagram prints: say why when updating them.
    // - Phase 1b: a flow page takes its steps per page and derives its shape, the
    //   one that prints the largest pictures. Every flow fixture already in that
    //   shape prints as it did (14 of the 16 digests); the enlarged steps' six a
    //   page are 2 × 3 now, not 3 × 2, and the seven-steps fixture is new.
    // 2026-10-08: the flow band is 20 mm wide by default, no longer in proportion
    // to the steps (`diagram-review-fixes.md`, item 1). Every flow page's print
    // changed by its band alone; the Pages view's page and its arrows did not.
    // October 10: balanced packing replaces fixed flow rows; explicit enlarged
    // Size is honored past its old room. Grid fixtures without Size remain unchanged.
    const digests = Object.fromEntries(
      pageLayoutFixtures().flatMap(({ name, document }) =>
        printed(document).pages.map((page, index) => [
          `${name} · page ${index + 1}`,
          [digest(page.svg), digest(page.view), digest(JSON.stringify(page.arrows))].join(' '),
        ])
      )
    );
    expect(digests).toMatchInlineSnapshot(`
      {
        "a newer build’s steps and turns · page 1": "f803ef9681c5a607 f803ef9681c5a607 4f53cda18c2baa0c",
        "a newer build’s steps and turns · page 2": "85e09522e6de28d1 85e09522e6de28d1 4f53cda18c2baa0c",
        "enlarged steps: a Fill run, a Size, and one waiting for its picture · page 1": "4633d85b2846d328 af5d80b1f4bfa2c4 38230ba7ef98046e",
        "enlarged steps: a Fill run, a Size, and one waiting for its picture · page 2": "e514e05fe15c024d ec8578ca7a5eba3a 4f53cda18c2baa0c",
        "flow from the right, across spreads, rows read upward · page 1": "c33a13c32d48a12f 838513c1e7d9b2fc 4f53cda18c2baa0c",
        "flow from the right, across spreads, rows read upward · page 2": "ff14836c9b067ce2 3c93ab409c165720 4f53cda18c2baa0c",
        "flow from the right, across spreads, rows read upward · page 3": "7dc43f31b0e27566 25f1d5eead9cd7e8 4f53cda18c2baa0c",
        "flow landscape, an odd row count · page 1": "8a22bcd7250e0283 d6c49700a718876e 4f53cda18c2baa0c",
        "flow landscape, an odd row count · page 2": "673dcc91ac1f43ff b06c04f39dffda06 4f53cda18c2baa0c",
        "flow, a page break and turns at a row’s end · page 1": "21a98eebb20a5a9d 84d7969e8086ba06 4f53cda18c2baa0c",
        "flow, a page break and turns at a row’s end · page 2": "723736f8d4030a08 2b200e9f7de1e546 4f53cda18c2baa0c",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 1": "6903c78b1b27aec6 90d75618d305c07d 4f53cda18c2baa0c",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 2": "efdb9ff897e8d19e 4359ed9b33f74e33 4f53cda18c2baa0c",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 3": "ef85321fd097fb72 380fbfe2900b5729 4f53cda18c2baa0c",
        "grid, a page break, turns and an upload · page 1": "762034dc73a12f50 762034dc73a12f50 4f53cda18c2baa0c",
        "grid, a page break, turns and an upload · page 2": "8254deff8fc82487 8254deff8fc82487 4f53cda18c2baa0c",
        "grid, two pages · page 1": "55238bffde0a38d1 55238bffde0a38d1 4f53cda18c2baa0c",
        "grid, two pages · page 2": "776e2e1611d8dbc7 776e2e1611d8dbc7 4f53cda18c2baa0c",
        "no steps · page 1": "21be575f25d70a47 21be575f25d70a47 4f53cda18c2baa0c",
      }
    `);
  });
});
