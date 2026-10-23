import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldSentenceExtent, FoldSentenceStep } from '../../fold/stepSentence';
import type { FoldCreaseDiff } from '../../fold/stepWords';
import { TooltipProvider } from '../ui/Tooltip';
import { FoldStepPane, type FoldStepPaneStep } from './FoldStepPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// The app's root provides the tooltips a row's help mark opens.
const render = (props: ComponentProps<typeof FoldStepPane>) =>
  act(() =>
    root.render(
      <TooltipProvider>
        <FoldStepPane {...props} />
      </TooltipProvider>
    )
  );

/** Each static row as label → value, found by the rows' data attributes. */
function rows(): Record<string, string> {
  return Object.fromEntries(
    [...host.querySelectorAll('[data-field-row]')].map((row) => [
      row.querySelector('[data-field-label]')?.textContent ?? '',
      row.querySelector('[data-field-value]')?.textContent ?? '',
    ])
  );
}

const heading = () => host.querySelector('h3')?.textContent;
const notices = () => [...host.querySelectorAll('[role="status"], [role="alert"]')].map((n) => n.textContent);
const section = (title: string) =>
  [...host.querySelectorAll('[role="group"]')].find((group) => group.getAttribute('aria-label') === title);

const DIFF: FoldCreaseDiff = { added: { mountain: 1, valley: 1, flat: 0 }, refolded: 0, reversed: 0, unfolded: 0 };

const VALLEY_STEP: FoldStepPaneStep = {
  words: {
    op: 'fold',
    direction: 'valley',
    line: { via: 'axiom', axiom: 2, inputs: [{ kind: 'corner', corner: 'sw' }, { kind: 'corner', corner: 'ne' }], moving: [1], inHalf: true },
    scope: { kind: 'all' },
  },
  number: 2,
  layers: 2,
  creases: { mountain: 1, valley: 2, flat: 1 },
  diff: DIFF,
  status: 'ok',
};

describe('FoldStepPane', () => {
  it('shows the flat sheet with nothing to describe yet', () => {
    render({ step: null, startSide: 'front' });
    expect(heading()).toBe('Flat sheet');
    expect(host.textContent).toContain('Nothing is folded yet. Fold the sheet to make step 1.');
    expect(rows()).toEqual({});
    expect(notices()).toEqual([]);
  });

  it('says a step by its number, kind, sentence and rows', () => {
    render({ step: VALLEY_STEP, startSide: 'front' });
    expect(heading()).toBe('Step 2');
    expect(host.querySelector('header')?.textContent).toBe('Step 2Valley');
    expect(host.textContent).toContain(
      'Valley fold in half, bringing the top-right corner onto the bottom-left corner, through all layers.'
    );
    expect(rows()).toEqual({
      Operation: 'Valley fold',
      Line: 'Axiom 2 · point onto point',
      Layers: '2',
      Changes: 'Adds 2 creases (1 M, 1 V)',
      Mountain: '1',
      Valley: '2',
      Flat: '1',
    });
    // The layer count explains what a layer is.
    expect(host.querySelector('[data-field-help]')?.getAttribute('aria-label')).toContain('deepest stack');
  });

  it('says a reverse fold by its kind, its opening, its layer order and its blocks', () => {
    render({
      step: {
        words: { op: 'reverse', kind: 'inside', line: { via: 'free' }, scope: { kind: 'flaps', flaps: 1 } },
        number: 3,
        layers: 2,
        creases: { mountain: 2, valley: 4, flat: 0 },
        diff: { added: { mountain: 1, valley: 1, flat: 0 }, refolded: 0, reversed: 2, unfolded: 0 },
        status: 'ok',
        compound: { blocks: 2, opening: 'chosen', orderChosen: false },
      },
      startSide: 'front',
    });
    expect(host.querySelector('header')?.textContent).toBe('Step 3Inside reverse');
    expect(host.textContent).toContain('Inside reverse fold along the line drawn, reversing only the flap shown.');
    expect(rows()).toMatchObject({
      Operation: 'Inside reverse fold',
      Line: 'Free line',
      Opening: 'Chosen among several',
      Blocks: '2',
    });
    expect(rows()).not.toHaveProperty('Layer order');
  });

  it('names both a crimp’s lines, in its sentence and its rows', () => {
    render({
      step: {
        words: {
          op: 'crimp',
          crimp: 'outside',
          line: { via: 'axiom', axiom: 1, inputs: [{ kind: 'point' }, { kind: 'point' }] },
          second: 'crease',
          scope: { kind: 'all' },
        },
        number: 4,
        layers: 2,
        creases: { mountain: 3, valley: 4, flat: 0 },
        diff: { added: { mountain: 2, valley: 2, flat: 0 }, refolded: 0, reversed: 1, unfolded: 0 },
        status: 'ok',
        compound: { blocks: 4, opening: 'only', orderChosen: true },
      },
      startSide: 'front',
    });
    expect(host.querySelector('header')?.textContent).toBe('Step 4Crimp');
    expect(host.textContent).toContain(
      'Outside crimp along the line joining point P and point Q, then back along an existing crease beyond it, through all layers.'
    );
    expect(rows()).toMatchObject({
      Operation: 'Outside crimp',
      'First line': 'Axiom 1 · through two points',
      'Second line': 'Existing crease',
      Opening: 'The only one',
      'Layer order': 'Chosen among several',
      Blocks: '4',
    });
    expect(rows()).not.toHaveProperty('Line');
  });

  it('names a tuck’s line, and its block', () => {
    render({
      step: {
        words: { op: 'tuck', direction: 'mountain', line: { via: 'free' } },
        number: 3,
        layers: 2,
        creases: { mountain: 1, valley: 1, flat: 0 },
        diff: { added: { mountain: 1, valley: 0, flat: 0 }, refolded: 0, reversed: 0, unfolded: 0 },
        status: 'ok',
        compound: { blocks: 1, opening: null, orderChosen: false },
      },
      startSide: 'front',
    });
    expect(rows()).toMatchObject({ Operation: 'Mountain fold and tuck', Line: 'Free line', Blocks: '1' });
    expect(rows()).not.toHaveProperty('Opening');
    expect(rows()).not.toHaveProperty('Second line');
  });

  it('names a petal fold’s hinge, and a swivel’s target and ridge, as rows of their own', () => {
    const vertex = (words: FoldSentenceStep): FoldStepPaneStep => ({
      words,
      number: 4,
      layers: null,
      creases: { mountain: 2, valley: 2, flat: 0 },
      diff: DIFF,
      status: 'ok',
      compound: { blocks: 3, opening: null, orderChosen: false, blocksOf: 'vertex' },
    });
    render({ step: vertex({ op: 'vertex', fold: 'petal', direction: 'valley', form: { hinge: 'points' } }), startSide: 'front' });
    expect(host.textContent).toContain('Petal-fold the flap, creasing its hinge as it lifts.');
    expect(rows()).toMatchObject({ Operation: 'Petal fold', Hinge: 'Two points, creased by the fold' });
    render({
      step: vertex({ op: 'vertex', fold: 'swivel', direction: 'valley', form: { swivel: 'edge', target: 'crease', ridge: 'foot' } }),
      startSide: 'front',
    });
    expect(host.textContent).toContain('Swivel the edge onto the crease, pivoting at the point.');
    expect(rows()).toMatchObject({ 'Lands on': 'Existing crease or edge', Ridge: 'Square to the edge' });
    expect(rows()).not.toHaveProperty('Hinge');
  });

  it('labels the crease counts as the front’s, and says so plainly when the back starts up', () => {
    render({ step: VALLEY_STEP, startSide: 'front' });
    expect(section('Creases')?.textContent).toContain('As seen from the front of the paper.');
    render({ step: VALLEY_STEP, startSide: 'back' });
    expect(section('Creases')?.textContent).toContain('which starts face down');
  });

  it('lays the step’s spread out with the Diagram’s rows, and says where it comes from', () => {
    const toggle = vi.fn();
    const choose = vi.fn();
    const choice = <T extends string>(value: T, label: string, pressed: boolean) => ({
      value,
      label,
      pressed,
      disabled: false,
      waiting: false,
      run: pressed ? () => {} : choose,
    });
    render({
      step: VALLEY_STEP,
      startSide: 'front',
      spread: {
        origin: 'earlier',
        toggle: { pressed: true, disabled: false, run: toggle },
        spread: {
          spread: { kind: 'depth', amount: 0.05, toward: 'down' },
          disabled: false,
          kinds: [choice('affine', 'Affine', false), choice('depth', 'Depth', true)],
          directions: [choice('down', 'Deeper layers down', true), choice('up', 'Deeper layers up', false)],
          keeps: [],
          preview: vi.fn(),
          commit: vi.fn(),
          start: () => true,
        },
      },
    });
    const spread = section('Spread');
    // Right after the step's rows: its first section, nothing written to read between.
    expect(host.querySelector('[role="group"]')).toBe(spread);
    expect(host.querySelector('textarea')).toBeNull();
    expect(spread?.textContent).toContain('As an earlier step sets it.');
    expect(spread?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(spread?.querySelector('input[type="range"]')?.getAttribute('aria-label')).toBe('Spread amount');
    act(() => (spread?.querySelector('[role="switch"]') as HTMLElement).click());
    expect(toggle).toHaveBeenCalledOnce();
    act(() => (spread?.querySelector('button[aria-label="Deeper layers up"]') as HTMLElement).click());
    expect(choose).toHaveBeenCalledOnce();
    // The flat sheet has none to offer.
    render({ step: null, startSide: 'front', spread: null });
    expect(section('Spread')).toBeUndefined();
  });

  it('gives each kind of change its own line', () => {
    render({
      step: { ...VALLEY_STEP, diff: { added: { mountain: 0, valley: 0, flat: 2 }, refolded: 1, reversed: 0, unfolded: 1 } },
      startSide: 'front',
    });
    const changes = [...host.querySelectorAll('[data-field-value] > span > span')].map((line) => line.textContent);
    expect(changes).toEqual(['Adds 2 precreases', 'Refolds 1 precrease', 'Unfolds 1 crease']);
  });

  it('says how much of its line a precrease creased, and counts a pinch’s marks', () => {
    const words = (extent?: FoldSentenceExtent): FoldSentenceStep => ({
      op: 'precrease',
      direction: 'valley',
      line: { via: 'free' },
      scope: { kind: 'all' },
      ...(extent ? { extent } : {}),
    });
    const marks = (count: number): FoldCreaseDiff => ({
      added: { mountain: 0, valley: 0, flat: 0 },
      refolded: 0,
      reversed: 0,
      unfolded: 0,
      marks: count,
    });
    const pinch: FoldStepPaneStep = { ...VALLEY_STEP, words: words({ kind: 'pinch', at: { kind: 'point' } }), diff: marks(2) };
    render({
      step: pinch,
      startSide: 'front',
      pending: { words: words({ kind: 'segment', from: { kind: 'point' }, to: { kind: 'point' } }), diff: marks(1) },
    });
    expect(rows()).toMatchObject({ Extent: 'Pinch', Changes: 'Adds 2 pinch marks' });
    expect(host.textContent).toContain('Crease only a short pinch at point P.');
    // The fold being made: a segment's mark.
    expect([...host.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['Adds 1 crease mark']);
    // A precrease of the whole line says so; any other fold has no Extent row.
    render({ step: { ...pinch, words: words() }, startSide: 'front' });
    expect(rows()).toMatchObject({ Extent: 'Whole line' });
    render({ step: VALLEY_STEP, startSide: 'front' });
    expect(rows()).not.toHaveProperty('Extent');
  });

  it('titles a turn by what it is, with no number, line or layers', () => {
    render({
      step: {
        words: { op: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } },
        number: null,
        layers: null,
        creases: { mountain: 1, valley: 2, flat: 1 },
        diff: { added: { mountain: 0, valley: 0, flat: 0 }, refolded: 0, reversed: 0, unfolded: 0 },
        status: 'ok',
      },
      startSide: 'front',
    });
    expect(host.querySelector('header')?.textContent).toBe('Turn over');
    expect(host.textContent).toContain('Turn over, side to side.');
    expect(rows()).toMatchObject({ Operation: 'Turn over, side to side', Changes: 'Changes no creases' });
    expect(rows()).not.toHaveProperty('Line');
    expect(rows()).not.toHaveProperty('Layers');
  });

  it('says an imported crease pattern is one, and where it came from', () => {
    render({
      step: { ...VALLEY_STEP, words: { op: 'cp-jump' }, layers: null, origin: 'fold' },
      startSide: 'front',
    });
    expect(rows()).toMatchObject({ Operation: 'Import crease pattern', Source: 'FOLD file' });
    expect(notices()).toEqual([
      'Imported crease pattern: this step replaces the folded state with the pattern’s own.',
    ]);
  });

  it('offers a broken step’s fixes with its notice, and shows only what it still knows', () => {
    const remove = vi.fn();
    render({
      step: { ...VALLEY_STEP, layers: null, creases: null, diff: null, status: 'broken' },
      startSide: 'front',
      fixes: [{ id: 'delete', label: 'Delete this step and what follows', run: remove }],
    });
    const notice = host.querySelector('[role="status"]');
    expect(notice?.getAttribute('data-tone')).toBe('warning');
    expect(notice?.textContent).toContain('This step no longer folds');
    act(() => notice?.querySelector('button')?.click());
    expect(remove).toHaveBeenCalledOnce();
    expect(rows()).toEqual({ Operation: 'Valley fold', Line: 'Axiom 2 · point onto point' });
    expect(section('Creases')).toBeUndefined();
  });

  it('says a step broke on the face cap by its count and the cap, keeping its delete', () => {
    const remove = vi.fn();
    render({
      step: {
        ...VALLEY_STEP,
        layers: null,
        creases: null,
        diff: null,
        status: 'broken',
        cap: { kind: 'faces', faceCount: 4160, limit: 4096 },
      },
      startSide: 'front',
      fixes: [{ id: 'delete', label: 'Delete this step and what follows', run: remove }],
    });
    const notice = host.querySelector('[role="status"]');
    expect(notice?.getAttribute('data-tone')).toBe('warning');
    expect(notice?.textContent).toContain(
      'This step has 4,160 faces, more than the 4,096 Fold folds. It and the steps after it can only be deleted.'
    );
    act(() => notice?.querySelector('button')?.click());
    expect(remove).toHaveBeenCalledOnce();
  });

  it('says a step broke on the stacking cap by its deepest stack, keeping its delete', () => {
    const remove = vi.fn();
    render({
      step: {
        ...VALLEY_STEP,
        layers: null,
        creases: null,
        diff: null,
        status: 'broken',
        cap: { kind: 'stack', deepest: 1290, triples: 357_349_080, limit: 4_000_000 },
      },
      startSide: 'front',
      fixes: [{ id: 'delete', label: 'Delete this step and what follows', run: remove }],
    });
    const notice = host.querySelector('[role="status"]');
    expect(notice?.getAttribute('data-tone')).toBe('warning');
    expect(notice?.textContent).toContain(
      'This step stacks its layers too deeply for Fold to work out their order, up to 1,290 on top of each other. It and the steps after it can only be deleted.'
    );
    act(() => notice?.querySelector('button')?.click());
    expect(remove).toHaveBeenCalledOnce();
  });

  it('says why a step cannot be read: one before it broke, a newer build, or a changed engine', () => {
    render({ step: { ...VALLEY_STEP, status: 'brokenAbove' }, startSide: 'front' });
    expect(notices()).toEqual(['A step before this one no longer folds, so this one cannot be shown.']);
    render({ step: { ...VALLEY_STEP, words: { op: 'unknown' }, status: 'locked' }, startSide: 'front' });
    expect(notices()[0]).toContain('made with a newer Ori Studio');
    expect(host.querySelector('header')?.textContent).toBe('Step 2Newer');
    render({ step: { ...VALLEY_STEP, status: 'changed' }, startSide: 'front' });
    expect(notices()).toEqual(['This step folds differently than when it was saved. Check its inputs and the steps above it.']);
  });

  it('says folding away from the tip starts a branch, at a step or at the sheet', () => {
    render({ step: VALLEY_STEP, startSide: 'front', branch: { at: 2, total: 5 } });
    expect(notices()).toEqual(['You are at step 2 of 5: folding here starts a new branch.']);
    render({ step: null, startSide: 'front', branch: { at: 0, total: 5 } });
    expect(notices()).toEqual(['You are at the flat sheet: folding here starts a new branch.']);
  });

  it('shows the fold in progress: its sentence and what it adds', () => {
    render({
      step: null,
      startSide: 'front',
      pending: {
        words: { op: 'fold', direction: 'mountain', line: { via: 'free' }, scope: { kind: 'depth', layers: 2 } },
        diff: { added: { mountain: 2, valley: 2, flat: 0 }, refolded: 0, reversed: 0, unfolded: 0 },
      },
    });
    const pending = section('Pending fold');
    expect(pending?.textContent).toContain('Mountain fold along the line drawn, folding only the bottom 2 layers.');
    expect([...(pending?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'Adds 4 creases (2 M, 2 V)',
    ]);
    // A section the user can fold away, open to start with.
    expect(host.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('says a refused fold has nothing to change until it is resolved, and a landing one nothing yet', () => {
    const words = { op: 'fold', direction: 'valley', line: { via: 'free' }, scope: { kind: 'all' } } as const;
    render({ step: null, startSide: 'front', pending: { words, diff: null, refused: true } });
    expect(section('Pending fold')?.textContent).toContain(
      'Resolve the issue in the tool window to see the creases it makes.'
    );
    render({ step: null, startSide: 'front', pending: { words, diff: null } });
    expect(section('Pending fold')?.querySelectorAll('li')).toHaveLength(0);
    expect(section('Pending fold')?.textContent).not.toContain('Resolve');
  });
});
