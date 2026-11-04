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
 *
 * And the homes golden (`implementation-plans/diagram-flow-pages.md`, Goal):
 * where the layout puts each step — its cell, its number and its text — held
 * to stored digests, page by page. A hand placement is an offset from its
 * step's home, so a home that moves moves every placed step of every diagram
 * saved with one: the layout froze at launch, and this says when it changes.
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
    // October 11: occupied shape packing, local symbol clearances and fairer
    // ribbon connectors change flow output; grid rendering remains unchanged.
    // October 11, later (`diagram-flow-pages.md`, Phase 2): packing is gone and
    // flow pages are #436's cells again, cut from each page's plan — balanced
    // rows, odd rows on a left page that hands over, a page laid out for the
    // steps it holds — and the band ends just past the diagram's last step.
    // Every flow fixture changed; the Pages view's pages that only lost their
    // band's end are as Phase 1b printed them (the enlarged steps' page 1, both
    // views, and their page 2, the page break's page 2 and the seven steps'
    // page 3, in the view). Grid fixtures are unchanged.
    // Two fixtures added, no digest changed: pages with their own counts, and a
    // grid's enlarged steps at a Size of 2 and of 6, whose page is #436's byte
    // for byte (checked against #436's build, its fonts loaded in the browser).
    // October 12 (`diagram-flow-packing.md`, Phase 3): flow pages are packed by
    // their steps' shapes into bands, a step may stand in a bend, and the band
    // turns at the page's edge. Every flow fixture changed, both views; grid
    // fixtures are unchanged. Phase 5 rasterised each of the 19 changed flow
    // pages and checked them by eye against the plan's packing and the
    // prototype's look: bands in reading order, steps in bends, the lane
    // meeting the spine and ending at the last box. No digest changed in
    // Phases 4 or 5.
    // Review fixes (`diagram-flow-packing.md`, "Review fixes"): a flow page keeps
    // the enlarge arrow's gutter before every enlarged step after another,
    // printing or not, so the enlarged steps' page 1 packs with a gutter before
    // its Size step and its step waiting for a picture. A step stands in a
    // bend only with a real step after it: the last pages of "flow from the
    // right" and "seven steps a page" no longer end on a step hanging in a
    // bend before stand-ins; their last step starts the next band, the lane
    // turning at the page's edge into it (rasterised and checked by eye). A
    // turn beside a step in a bend stands midway between the two pictures and
    // moves the least way clear of every step's number, picture and caption:
    // four pages' turns move (own counts 2 and 4, seven a page 1 and 2), each
    // off a picture it stood on or against, into the gap between the two
    // boxes (rasterised and checked by eye). No home moved.
    // October 12, later (Zach): a turn prints only between two steps. The grid
    // fixture's turn after its last step is no longer drawn, so its page 2
    // changed, and only that page.
    // 2026-10-12, F2 (`diagram-flow-packing.md`, Reference size): every flow
    // step's reference scale is found in the diagram's one cell (its steps per
    // page's), never its own page's. Seven pages changed, each a page whose own
    // rows were not the default's: "flow from the right" pages 2 and 3 (page 2
    // hands over at its spine, so its rows were odd; it prints its pictures as
    // before, its empty step 7's box taller, and page 3 only its band across
    // the spread), and every page of "pages with their own counts" (counts of
    // 3, 4, 3 and 5 against the default 9: pages 1–4 print their pictures at
    // 1.4 times the 3 × 3 cell's, the packing's largest, 54 mm where they were
    // 59–63, and page 5 at 50 mm where it was 44). Rasterised and checked by
    // eye beside the pages before. Grid fixtures are unchanged.
    // 2026-10-12, later (Zach): an enlarged step's Size is drawn past its room,
    // as a size pinned by hand is. One page changed: the grid's enlarged steps
    // at a Size of 2 and of 6, whose step at 6 prints at six times its area
    // (a 85.92 mm window, drawn 49.12 × 86.10 mm) where #436 held it to its
    // room at 4.89 times (69.99 mm, 48 × 70.17), its caption pushed down under
    // it; every other step on the page, and its arrows, as they were. The flow
    // fixture's Size of 2 fits its room, so its pages are unchanged.
    // 2026-10-13 (Zach, crane steps 3→4): a bend with no step in it keeps its
    // band inside the margin, turning under its rows' end pictures in quarter
    // circles where they stand near it (`flowLane.ts`, `bendKnots`). Sixteen
    // flow pages' bands changed: every fixture page with such a bend (each of
    // them had reached into the margin); two of them also move the turn standing in that bend, with the
    // bend, in the view: "a page break and turns at a row's end" page 1 and
    // "pages with their own counts" page 4. No arrow, home or grid page moved.
    // 2026-10-13 (Zach): a caption stands 3 mm under its picture, 2 before
    // (`CAPTION_TOP_MM`). Every flow fixture page changed: none holds an
    // arrangement, so each is packed afresh with its captioned boxes a
    // millimetre taller (`pack-6`). A page held as saved keeps its boxes and
    // its pictures, only its captions lower (`savedPagesHold.test.ts`). Grid
    // fixtures are unchanged: a grid's caption keeps its 5 mm baseline.
    // 2026-10-14 (Zach, "(b4)" of the crane's turns): the lane is one curve,
    // its curvature continuous, through every picture's centre and each turn's
    // middle; a turn the margin keeps from a round loop stands on it, a row
    // bowing over its next-to-last picture the least that keeps the turn no
    // tighter than 22 mm (`flowLane.ts`). Every flow fixture page's print
    // changed, by its band alone (19 pages); in the view, the two whose turn
    // glyph stands at a turn's middle on the band: "a page break and turns at a
    // row's end" page 1 and "pages with their own counts" page 4. Rasterised
    // and checked by eye beside the pages before, steps in a bend turning round.
    // No arrow, home or grid page moved.
    // 2026-10-14, later (Zach's crane: the ribbon leaving page 2 and coming into
    // page 3 did not line up): over a page turn after a right page that read up,
    // the lane leaves one page and comes into the next at one height, halfway
    // between the two pictures, as over the spine (`handoverHeight`). Six pages'
    // prints changed by their band alone, either side of the three page turns
    // the fixtures hand over at: "seven steps a page" pages 2 and 3, and "pages
    // with their own counts" pages 2–5; in the view, that fixture's page 4, whose
    // turn glyph stands at a turn's middle on the band. Rasterised and checked by
    // eye beside the pages before. No arrow, home or grid page moved.
    // 2026-10-15 (Zach: step 1 starts "at the top left of the steps"): a page's
    // first band starts at its area's left edge, its spare width shared between
    // its steps and after its last, where it kept half a share before its first
    // step (`flowPacking.ts`). Every flow page whose first band had spare width
    // changed, both views (17 pages): "a page break and turns at a row's end"
    // page 2, "flow from the right" pages 1–3, "seven steps a page" pages 1–3,
    // "pages with their own counts" pages 1–4, "a last page with its own count"
    // pages 1 and 2, "flow landscape" pages 1 and 2, and the enlarged steps'
    // pages 1 and 2. A first band of one step moves furthest, from near the
    // middle to the left (up to 66 mm). Each page is packed afresh, none holding
    // an arrangement; a page held as saved keeps its boxes. Rasterised and
    // checked by eye beside the pages before (first bands only; later bands,
    // the lane's rules and every arrow as they were). Grid pages are unchanged.
    // 2026-10-15, later (Zach: steadiness 0.5 for a new diagram, 0.85 before;
    // cherry-picked without the typical-page rule, which was built and not
    // merged): every fixture is a new diagram's, so each page may grow ×1.3
    // past the page before it where it grew ×1.09. One page grew: "a last page
    // with its own count" page 2, its one step at the largest scale, 1.4,
    // where it was held to 1.328 (its picture 5% larger, its box up to 7.8 mm
    // moved); its page 1 changed by the band handed over to it alone (5
    // thousandths of a mm), in the print. Two pages packed at their own size
    // already, a millionth off it now, their numbers a thousandth of a mm at
    // most: "flow landscape" page 2 and "seven steps a page" page 2, both
    // views. Each is a second page, held to its first page under either rule,
    // so these are the digests the cherry-picked commit took. One more here,
    // under the page-before rule: "flow from the right" page 3, in the print
    // only, its cap (×1.3 page 2's) far above what it packs at but the scale
    // search, halving from it, ending two millionths lower (0.966025 →
    // 0.966023), its numbers a ten-thousandth of a mm off at most. No arrow or
    // grid page moved.
    // 2026-10-15, later (Zach's crane, steps 14→15: the turn "should be
    // equidistant between the two steps along the ribbon path"): a turn across
    // a bend, or beside a step in one, stands on the lane midway along it
    // between where it leaves the one picture and reaches the other, or as near
    // that along it as it stands clear (`laneStretch`), where it stood at the
    // turn's middle or midway between the two pictures' centres. Five pages
    // changed, both views, by one glyph each: "a page break and turns at a
    // row's end" page 1 (3→4, 3.1 mm), "pages with their own counts" pages 2
    // (5→6, 20.0 mm) and 4 (12→13, 13.1 mm), "seven steps a page" page 1 (3→4,
    // 17.0 mm) and "flow landscape" page 1 (7→8, 8.2 mm). No home, arrow,
    // band or grid page moved.
    // 2026-10-15, later still (Zach): a glyph between two steps on one flow row
    // stands midway along the ribbon too, where it stood midway between the
    // two boxes at the pictures' mean height; and glyphs clear nowhere along
    // their stretch stand on its middle all the same. Six pages changed, both
    // views, by one glyph each: "a page break and turns at a row's end" pages
    // 1 (5→6, 7.3 mm) and 2 (9→10, 2.1 mm), "seven steps a page" pages 1 (6→7,
    // 5.2 mm) and 2 (10→11, 6.6 mm), "a last page with its own count" page 1
    // (4→5, 7.1 mm), and the enlarged steps' page 1, whose arrow beside its
    // area moved 0.05 mm across before it is lifted to the area. No home, band
    // or grid page moved.
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
        "enlarged steps: a Fill run, a Size, and one waiting for its picture · page 1": "69c0bd25631007ce 89514ea704cdd27a e264fc6f3bfa35c3",
        "enlarged steps: a Fill run, a Size, and one waiting for its picture · page 2": "6f0a09122da36e45 ac52759daf91f1bb 4f53cda18c2baa0c",
        "flow from the right, across spreads, rows read upward · page 1": "112071bbf0ef8d2a a17ea0be4c9ff643 4f53cda18c2baa0c",
        "flow from the right, across spreads, rows read upward · page 2": "3806a26235e98c81 1a2ba3bcdc4a97af 4f53cda18c2baa0c",
        "flow from the right, across spreads, rows read upward · page 3": "4ffec0e00275d974 4e556a1f96e3d587 4f53cda18c2baa0c",
        "flow landscape, an odd row count · page 1": "7713010296a47f37 2f03217f51c4249c 4f53cda18c2baa0c",
        "flow landscape, an odd row count · page 2": "391d8c633d8c12fd a00182ef4cb75e7e 4f53cda18c2baa0c",
        "flow, a last page with its own count · page 1": "763637fa1fbfc08f 8cf35b99b1f4109e 4f53cda18c2baa0c",
        "flow, a last page with its own count · page 2": "c7945e9df33c6410 07afe7fb8e35e5b8 4f53cda18c2baa0c",
        "flow, a page break and turns at a row’s end · page 1": "05993aee80b2115d 526b04916cacf11b 4f53cda18c2baa0c",
        "flow, a page break and turns at a row’s end · page 2": "0180347d0422d7b8 79bae3e585680021 4f53cda18c2baa0c",
        "flow, pages with their own counts · page 1": "b95ac905ca9104aa 7fcdc750dac69d2b 4f53cda18c2baa0c",
        "flow, pages with their own counts · page 2": "8c4939afa8f7745c 84cbf972bb4500a1 4f53cda18c2baa0c",
        "flow, pages with their own counts · page 3": "4cce1725247f86de 5f4e7c904e03cb91 4f53cda18c2baa0c",
        "flow, pages with their own counts · page 4": "8ad2fbdc3b7376c2 12fab43f5f246697 4f53cda18c2baa0c",
        "flow, pages with their own counts · page 5": "ece26eda8a93adec 550b8d887bc9495a 4f53cda18c2baa0c",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 1": "e77094730ef8afb3 d533a648e725b825 4f53cda18c2baa0c",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 2": "e0bba33a1ff38a15 f2f7047421073473 4f53cda18c2baa0c",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 3": "26b0041be8aefdb8 d4e7c4bb5143c429 4f53cda18c2baa0c",
        "grid, a page break, turns and an upload · page 1": "15e1274df2ca75ad 15e1274df2ca75ad 4f53cda18c2baa0c",
        "grid, a page break, turns and an upload · page 2": "d1861a903da9ec13 d1861a903da9ec13 4f53cda18c2baa0c",
        "grid, enlarged steps at a Size of 2 and of 6 · page 1": "bd28d9cef4eb23d5 bd28d9cef4eb23d5 f2a6c074db74a98c",
        "grid, two pages · page 1": "55238bffde0a38d1 55238bffde0a38d1 4f53cda18c2baa0c",
        "grid, two pages · page 2": "776e2e1611d8dbc7 776e2e1611d8dbc7 4f53cda18c2baa0c",
        "no steps · page 1": "21be575f25d70a47 21be575f25d70a47 4f53cda18c2baa0c",
      }
    `);
  });
});

/** A length in mm to a ten-thousandth: far finer than any print shows, and clear of rounding in the last bits. */
const mm = (value: number) => Math.round(value * 1e4) / 1e4;

describe('homes as the layout computes them', () => {
  it('are held to their digests: each step’s cell, number and text origin, page by page', () => {
    // Taken at the layout of `diagram-flow-pages.md`, Phase 2. A change here moves
    // where placed steps print in every diagram saved with a placement: say why
    // when updating them.
    // October 12 (`diagram-flow-packing.md`, Phase 3): a flow step's home is its
    // box on its page as packed, and held from then on in the file. Every flow
    // fixture changed (a fresh pack: none holds an arrangement); grid fixtures
    // are unchanged. No diagram with a placement had launched. Held from here:
    // `heldPages.test.ts` shows no caption or picture edit moves a home, on any
    // fixture, once its pages are packed and adopted.
    // Review fixes: the enlarged steps' page 1 keeps an arrow's gutter before
    // each enlarged step after another, and two short last pages put no step
    // in a bend before stand-ins (fresh packs; nothing held moved).
    // 2026-10-12, F2: each flow step's reference scale from the diagram's one
    // cell. The seven pages whose own rows were not the default's moved (fresh
    // packs under `pack-3`; a page stored by `pack-2` is packed afresh, its
    // placed frames sent home): "flow from the right" pages 2 and 3, and
    // every page of "pages with their own counts".
    // 2026-10-12, later (Zach): an enlarged step's Size drawn past its room.
    // The grid's enlarged steps at 2 and 6: step-zoom-6's caption starts
    // under its picture at six times its area (first baseline 206.77 mm, was
    // 190.83); its cell, its number and every other step's home as they were.
    // 2026-10-13 (Zach): a caption 3 mm under its picture, 2 before. Every flow
    // fixture page moved (fresh packs under `pack-6`, boxes with a caption a
    // millimetre taller); a page held as saved keeps every box and picture,
    // and its captions, which are a look, stand a millimetre lower — placed ones
    // with them, keeping their offsets (`savedPagesHold.test.ts`). Grid homes
    // as they were.
    // 2026-10-15 (Zach: step 1 at the top left of the steps): a page's first
    // band starts at its area's left edge. The same 17 flow pages as the print
    // golden above moved, only the homes in their first bands (fresh packs; a
    // page held as saved keeps every home, so no saved placement moves). Grid
    // homes as they were.
    // 2026-10-15, later (Zach: steadiness 0.5 for a new diagram): the print
    // golden's three pages that packed again ("a last page with its own
    // count" page 2, "flow landscape" page 2, "seven steps a page" page 2),
    // and the enlarged steps' page 2, its scale a millionth off (1.05484 →
    // 1.05483) and its homes under a hundredth of a mm off, its print the same;
    // and "flow from the right" page 3 (above), a ten-thousandth of a mm. A
    // saved diagram keeps the steadiness it says, so no saved home moves.
    // 2026-11-03: every arrowhead is one size, a short arrow's no longer capped
    // by its chord (Bodo). Four pages print a short fold arrow and changed by it
    // alone — "flow landscape, an odd row count" pages 1 and 2, "grid, a page
    // break, turns and an upload" pages 1 and 2 — each arrow's head larger and
    // its stroke stopped at the new notch (the SVGs diffed against `main`: no
    // other element moved). No home and no zoom arrow changed.
    const digests = Object.fromEntries(
      pageLayoutFixtures().flatMap(({ name, document }) =>
        preparedPages(document, FIXTURE_FONTS, subsetter).layout.pages.map((page, index) => [
          `${name} · page ${index + 1}`,
          digest(
            JSON.stringify(
              page.cells.map(({ stepId, cellMm, numberAt, text }) => [
                stepId,
                [cellMm.x, cellMm.y, cellMm.w, cellMm.h].map(mm),
                [numberAt.x, numberAt.y].map(mm),
                [text.x, text.firstBaseline, text.widthMm].map(mm),
              ])
            )
          ),
        ])
      )
    );
    expect(digests).toMatchInlineSnapshot(`
      {
        "a newer build’s steps and turns · page 1": "7c3808646e04671c",
        "a newer build’s steps and turns · page 2": "340f944242881549",
        "enlarged steps: a Fill run, a Size, and one waiting for its picture · page 1": "d277a9a582aa3d1c",
        "enlarged steps: a Fill run, a Size, and one waiting for its picture · page 2": "d4ed9556912dd243",
        "flow from the right, across spreads, rows read upward · page 1": "bd40e085511af7ae",
        "flow from the right, across spreads, rows read upward · page 2": "0385acdaa384f961",
        "flow from the right, across spreads, rows read upward · page 3": "6b436f4473a34632",
        "flow landscape, an odd row count · page 1": "15beff8eb84a5c59",
        "flow landscape, an odd row count · page 2": "ec0bf5eafcffb5d9",
        "flow, a last page with its own count · page 1": "400e36cecbffc115",
        "flow, a last page with its own count · page 2": "59c2cfd10a1857d4",
        "flow, a page break and turns at a row’s end · page 1": "79c46295f327baa4",
        "flow, a page break and turns at a row’s end · page 2": "308645cc7ac38862",
        "flow, pages with their own counts · page 1": "e63891a52a5f4e1f",
        "flow, pages with their own counts · page 2": "f735efd359792f3d",
        "flow, pages with their own counts · page 3": "2f2b032769cf329b",
        "flow, pages with their own counts · page 4": "c9c3c38055027a53",
        "flow, pages with their own counts · page 5": "f4f1e39875630a38",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 1": "8de763d72ee1d672",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 2": "6f1fabcfaf8a3fd0",
        "flow, seven steps a page: short last rows, across a spread and a page turn · page 3": "228c59f7cc3e5a78",
        "grid, a page break, turns and an upload · page 1": "b2981a60e29ba484",
        "grid, a page break, turns and an upload · page 2": "2866f10b51c574cb",
        "grid, enlarged steps at a Size of 2 and of 6 · page 1": "bcebae4d18202957",
        "grid, two pages · page 1": "40d6b4db9bf8a7e0",
        "grid, two pages · page 2": "2cf18aff84ac502b",
        "no steps · page 1": "4f53cda18c2baa0c",
      }
    `);
  });
});
