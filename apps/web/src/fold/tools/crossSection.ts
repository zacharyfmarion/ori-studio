/**
 * The cross-section at the fold line, as the tool window shows it (plan D14):
 * the layer picker's rows, the flap chips and the "n of m layers moving" line,
 * from the bridge's section (`FoldCrossSection`) and what the seed asks for.
 *
 * The engine does the geometry — the intervals, the display layers and their
 * order, the flaps, the bends that join rows. Every row is paper on the moving
 * side, in one flap. This decides what each row is called and how it reads:
 * picked, moved anyway, or left behind; where its bar runs; and which flap is
 * numbered 1. Every surface that names a flap — a chip, a row, a refusal's
 * fix — numbers it through {@link flapNumbers}, so "Flap 2" is the same flap
 * everywhere.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { FoldCrossSection, FoldCrossSectionRow, FoldFlap } from '../engine/foldEngineWire';

/** What moves by request, and what the engine says moves besides. */
export interface FoldSeedView {
  /** The flaps the seed names (indices into the section's flaps). */
  picked: ReadonlySet<number>;
  /** The flaps the closure moves beyond those (`FoldAnalysis.added`). */
  added: ReadonlySet<number>;
  /** The flaps a refusal's "include" fix names: the ones in the way. */
  needed: ReadonlySet<number>;
}

/** How a row reads: its flap picked, moved anyway by the closure, or left behind. */
export type FoldSectionRowState = 'picked' | 'added' | 'excluded';

export interface FoldSectionRow {
  /** Stable among the rows: the React key and the option's id suffix. */
  key: string;
  /** The row's number, 1 at the top. */
  layer: number;
  /** The option's accessible name. */
  label: string;
  /** Its flap: an index into the section's flaps. */
  flap: number;
  /** "Flap 2", on the first row of a run of the flap's rows; null on the rest. */
  tag: string | null;
  state: FoldSectionRowState;
  /** Its flap is in the way of the fold asked for (a refusal's fix names it). */
  needed: boolean;
  /** Placed beside the row above rather than under it (D14 cross-section, 3). */
  unordered: boolean;
  /** Where its bar runs, as fractions of the section's extent along the line. */
  from: number;
  to: number;
}

/** A bracket between two rows where a bend joins them, at a fraction along the line. */
export interface FoldSectionBracket {
  upper: number;
  lower: number;
  at: number;
  /** Which way it bulges: past the end of the rows it joins, or before their start. */
  side: 'start' | 'end';
}

export interface FoldSectionPickerModel {
  /** The listbox's accessible name. */
  label: string;
  /** Several flaps may be picked (a plain fold's seed); otherwise one. */
  multiple: boolean;
  rows: readonly FoldSectionRow[];
  brackets: readonly FoldSectionBracket[];
  /** The rows are one interval's stack, a woven section's (D14 cross-section, 3). */
  woven: boolean;
}

export interface FoldFlapChip {
  flap: number;
  /** "Flap 2": the chip's text. */
  name: string;
  /** "2 layers": its rows at the line. */
  detail: string;
  /** The chip's accessible name: its name, its rows, and whether it moves anyway. */
  label: string;
  pressed: boolean;
  added: boolean;
  needed: boolean;
}

/** Grouping faces into rows made a cycle: only one interval's stack at a time means anything. */
export function isWoven(section: Pick<FoldCrossSection, 'order'>): boolean {
  return section.order.kind === 'woven';
}

/**
 * Which interval of a woven section is under a point of the folded pane (D14
 * cross-section, 3): the point taken square onto the line, measured from the
 * section's start as its intervals are. Null for a section that is not
 * woven, where every interval is shown at once, and off both ends.
 */
export function wovenIntervalAt(section: FoldCrossSection | null, at: { x: number; y: number }): number | null {
  if (!section || !isWoven(section)) return null;
  const along = distanceAlong(section, at);
  if (along === null) return null;
  const index = section.intervals.findIndex((interval) => along >= interval.start && along <= interval.end);
  return index >= 0 ? index : null;
}

/**
 * A point of the scene frame taken square onto the section's line, as a
 * distance from its start: how its intervals and spans are measured. Null
 * for a section with no length.
 */
function distanceAlong(section: Pick<FoldCrossSection, 'from' | 'to'>, at: { x: number; y: number }): number | null {
  const dx = section.to.x - section.from.x;
  const dy = section.to.y - section.from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  return ((at.x - section.from.x) * dx + (at.y - section.from.y) * dy) / length;
}

/** How far a stretch of the line must run over a row's span to cross it: a touch at an end does not. */
const CROSSES = 1e-7;

/**
 * The flaps whose paper a stretch of the section's line runs over, between
 * two points of the scene frame (taken square onto the line), as indices
 * into the section's flaps in their order: every row there, at any depth,
 * not only the top one. A row whose span the stretch only touches at an end
 * is not crossed.
 */
export function flapsAlong(
  section: Pick<FoldCrossSection, 'from' | 'to' | 'rows' | 'flaps'>,
  a: { x: number; y: number },
  b: { x: number; y: number }
): number[] {
  const ta = distanceAlong(section, a);
  const tb = distanceAlong(section, b);
  if (ta === null || tb === null) return [];
  const [lo, hi] = ta <= tb ? [ta, tb] : [tb, ta];
  const crossed = new Set<number>();
  for (const row of section.rows) {
    if (row.spans.some(([start, end]) => Math.min(hi, end) - Math.max(lo, start) > CROSSES)) crossed.add(row.flap);
  }
  return [...crossed].filter((flap) => flap < section.flaps.length).sort((x, y) => x - y);
}

/**
 * Each flap's number on screen (1-based), indexed by the engine's flap index:
 * top to bottom by the flap's first row at the line, as a folder reads the
 * stack. The engine orders its flaps by face id, which means nothing to a
 * reader. A flap with no row there keeps its engine order after the rest.
 */
export function flapNumbers(section: FoldCrossSection | null, flapCount: number): number[] {
  const order: number[] = [];
  for (const row of section?.rows ?? []) {
    if (row.flap < flapCount && !order.includes(row.flap)) order.push(row.flap);
  }
  for (let flap = 0; flap < flapCount; flap += 1) {
    if (!order.includes(flap)) order.push(flap);
  }
  const numbers = new Array<number>(flapCount);
  order.forEach((flap, position) => {
    numbers[flap] = position + 1;
  });
  return numbers;
}

/**
 * The topmost flap at the line as the front shows it (an index into the
 * section's flaps): the flap of the section's top row. The rows run top to
 * bottom as the viewer sees them, so this is Flap 1. A woven section has no
 * one row order: its top is the top of the stack the picker shows first, its
 * first interval's. Null for a section with no rows.
 */
export function topFlapOf(section: Pick<FoldCrossSection, 'rows' | 'order' | 'intervals'>): number | null {
  const index = isWoven(section) ? section.intervals[0]?.rows[0] : 0;
  return index === undefined ? null : (section.rows[index]?.flap ?? null);
}

/** The same flap, by its faces: the engine names a flap by them wherever it lists one. */
export function sameFlap(a: FoldFlap, b: FoldFlap): boolean {
  return a.faces.length === b.faces.length && a.faces.every((face, k) => face === b.faces[k]);
}

/** A flap's name, by its number on screen. */
export function flapName(t: TFunction, number: number): string {
  return t('tools:fold.flap.name', 'Flap {{number}}', { number });
}

function rowState(flap: number, seed: FoldSeedView): FoldSectionRowState {
  if (seed.picked.has(flap)) return 'picked';
  return seed.added.has(flap) ? 'added' : 'excluded';
}

/**
 * The option's name. Whole sentences per case rather than clauses joined, so
 * a locale can order them (plan D14, Sentences).
 */
function rowLabel(t: TFunction, layer: number, flap: string, state: FoldSectionRowState, unordered: boolean): string {
  const above = layer - 1;
  if (state === 'added') {
    return unordered
      ? t('tools:fold.section.rowAddedBeside', 'Layer {{layer}}, {{flap}}, moves with the fold, beside layer {{above}}', {
          layer,
          flap,
          above,
        })
      : t('tools:fold.section.rowAdded', 'Layer {{layer}}, {{flap}}, moves with the fold', { layer, flap });
  }
  return unordered
    ? t('tools:fold.section.rowBeside', 'Layer {{layer}}, {{flap}}, beside layer {{above}}', { layer, flap, above })
    : t('tools:fold.section.row', 'Layer {{layer}}, {{flap}}', { layer, flap });
}

/** Where a row meets the line: from its first span's start to its last's end (a display layer is convex, so one span). */
function extent(row: FoldCrossSectionRow): readonly [number, number] {
  const first = row.spans[0] ?? [0, 0];
  const last = row.spans[row.spans.length - 1] ?? first;
  return [first[0], last[1]];
}

/** The stacks do not order row `index` against the row above it: they meet the line apart. */
function unorderedAbove(section: FoldCrossSection, index: number): boolean {
  return (
    section.order.kind === 'layered' && section.order.unordered.some(([i, j]) => i === index - 1 && j === index)
  );
}

/** The rows on show: every display layer, or for a woven section the stack of one interval, across it. */
function shownRows(
  section: FoldCrossSection,
  interval: number | null
): { rows: { row: FoldCrossSectionRow; index: number }[]; span: readonly [number, number] | null } {
  if (isWoven(section)) {
    const shown = section.intervals[interval ?? 0] ?? section.intervals[0];
    if (!shown) return { rows: [], span: null };
    const rows = shown.rows.flatMap((index) => {
      const row = section.rows[index];
      return row ? [{ row, index }] : [];
    });
    return { rows, span: [shown.start, shown.end] };
  }
  return { rows: section.rows.map((row, index) => ({ row, index })), span: null };
}

/**
 * The layer picker: a row per display layer, top to bottom, each named and
 * placed; and the brackets where a bend joins two of them. For a woven
 * section, the stack of the interval under the pointer (`interval`, else the
 * first), every row across the interval, and no brackets: there is no one
 * row order for them to join.
 */
export function foldSectionPicker(
  t: TFunction,
  section: FoldCrossSection,
  seed: FoldSeedView,
  { interval = null, multiple = true }: { interval?: number | null; multiple?: boolean } = {}
): FoldSectionPickerModel {
  const woven = isWoven(section);
  const numbers = flapNumbers(section, section.flaps.length);
  const { rows: shown, span } = shownRows(section, interval);
  const spans = shown.map(({ row }) => span ?? extent(row));
  const start = Math.min(...spans.map(([from]) => from));
  const length = Math.max(...spans.map(([, to]) => to)) - start;
  // A section with no length (one point on the line, or no rows) draws each bar whole.
  const measured = length > 0;
  const fraction = (at: number) => (measured ? Math.min(1, Math.max(0, (at - start) / length)) : 0);

  const rows = shown.map(({ row, index }, position): FoldSectionRow => {
    const name = flapName(t, numbers[row.flap] ?? row.flap + 1);
    const previous = shown[position - 1]?.row.flap;
    // In a woven stack, the rows are ordered by the stack itself.
    const unordered = !woven && position > 0 && unorderedAbove(section, index);
    const state = rowState(row.flap, seed);
    const [from, to] = spans[position] ?? extent(row);
    return {
      key: `row-${index}`,
      layer: position + 1,
      label: rowLabel(t, position + 1, name, state, unordered),
      flap: row.flap,
      tag: position === 0 || previous !== row.flap ? name : null,
      state,
      needed: seed.needed.has(row.flap),
      unordered,
      from: fraction(from),
      to: measured ? fraction(to) : 1,
    };
  });

  const brackets: FoldSectionBracket[] = woven
    ? []
    : section.joins.flatMap((join) => {
        const upper = section.rows[join.upper];
        if (!upper || !section.rows[join.lower] || join.upper === join.lower) return [];
        const [from, to] = extent(upper);
        return [
          {
            upper: Math.min(join.upper, join.lower),
            lower: Math.max(join.upper, join.lower),
            at: fraction(join.at),
            side: join.at >= (from + to) / 2 ? ('end' as const) : ('start' as const),
          },
        ];
      });

  return {
    label: woven
      ? t('tools:fold.section.labelWoven', 'Layers at the fold line under the pointer, top to bottom')
      : t('tools:fold.section.label', 'Layers at the fold line, top to bottom'),
    multiple,
    rows,
    brackets,
    woven,
  };
}

/** A chip per flap, in the order the flaps are numbered: the keyboard path to picking them (D14). */
export function foldFlapChips(t: TFunction, section: FoldCrossSection, seed: FoldSeedView): FoldFlapChip[] {
  const numbers = flapNumbers(section, section.flaps.length);
  return section.flaps
    .map((_, flap) => flap)
    .sort((a, b) => (numbers[a] ?? 0) - (numbers[b] ?? 0))
    .map((flap) => {
      const number = numbers[flap] ?? flap + 1;
      const count = section.rows.filter((row) => row.flap === flap).length;
      const pressed = seed.picked.has(flap);
      const added = !pressed && seed.added.has(flap);
      return {
        flap,
        name: flapName(t, number),
        detail: t('tools:fold.flap.layers', {
          count,
          defaultValue_one: '{{count}} layer',
          defaultValue_other: '{{count}} layers',
        }),
        label: added
          ? t('tools:fold.flap.chipAdded', {
              count,
              number,
              defaultValue_one: 'Flap {{number}}, {{count}} layer, moves with the fold',
              defaultValue_other: 'Flap {{number}}, {{count}} layers, moves with the fold',
            })
          : t('tools:fold.flap.chip', {
              count,
              number,
              defaultValue_one: 'Flap {{number}}, {{count}} layer',
              defaultValue_other: 'Flap {{number}}, {{count}} layers',
            }),
        pressed,
        added,
        needed: seed.needed.has(flap),
      };
    });
}

/**
 * "2 of 4 layers moving": the rows whose flap moves, of the rows on the moving
 * side — display layers, never faces (D14 cross-section, 2).
 */
export function foldLayersSummary(t: TFunction, picker: FoldSectionPickerModel): string {
  const moving = picker.rows.filter((row) => row.state === 'picked' || row.state === 'added').length;
  return t('tools:fold.window.layersMoving', {
    count: picker.rows.length,
    moving,
    defaultValue_one: '{{moving}} of {{count}} layer moving',
    defaultValue_other: '{{moving}} of {{count}} layers moving',
  });
}
