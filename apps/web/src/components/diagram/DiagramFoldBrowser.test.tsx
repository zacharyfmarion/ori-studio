import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStep, DEFAULT_DIAGRAM_STYLE, type DiagramPullAnchor, type DiagramStep } from '../../diagram/document/diagramDocument';
import { FOLD_PULL_RENDER, type FoldBrowserCard, type FoldBrowserPicture } from '../../diagram/fold/foldPull';
import type { FoldBrowserCardsState, FoldBrowserProvider, FoldMergeChoice } from '../../diagram/fold/useFoldBrowser';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramFoldBrowser } from './DiagramFoldBrowser';

/** What a landed card's capture has come to: the step it adds, still capturing (undefined), or nothing to draw (null). */
const preview = vi.hoisted(() => ({ result: undefined as DiagramStep | null | undefined, asked: [] as unknown[] }));

vi.mock('../../diagram/fold/useFoldPullPreview', () => ({
  useFoldPullPreview: (request: unknown) => {
    if (request) preview.asked.push(request);
    return request ? preview.result : undefined;
  },
}));
// The step is painted as a Diagram card paints one: here, as a fixed picture.
vi.mock('../../diagram/pictures/useStepPictureUrl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../diagram/pictures/useStepPictureUrl')>()),
  useStepPictureUrl: () => 'data:image/svg+xml,test-step',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  preview.result = createStep();
  preview.asked = [];
});

const REQUEST = {
  sequence: 'fold-1',
  target: { kind: 'step', step: 'fstep-1', moment: 'before' },
  render: FOLD_PULL_RENDER,
  key: 'fold-1|fstep-1||before|fh1:1',
} as const;
const THUMBNAIL: FoldBrowserPicture = { status: 'landed', preview: REQUEST };

/** A sequence's path as the browser lists it: two folds with a turn between them, and Finished; step 3 still folding. */
function cards(third: FoldBrowserPicture = { status: 'pending' }): FoldBrowserCard[] {
  return [
    { index: 0, kind: 'fold', number: 1, ids: ['fstep-1'], sentence: 'Valley fold in half.', picture: THUMBNAIL, step: { kind: 'step', step: 'fstep-1', moment: 'before' } },
    { index: 1, kind: 'turn-over', number: null, ids: ['fstep-2'], sentence: 'Turn over', picture: THUMBNAIL, step: { kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } } },
    { index: 2, kind: 'fold', number: 2, ids: ['fstep-3'], sentence: 'Valley fold the corner.', picture: THUMBNAIL, step: { kind: 'step', step: 'fstep-3', moment: 'before' } },
    { index: 3, kind: 'fold', number: 3, ids: ['fstep-4'], sentence: 'Fold the flap up.', picture: third, step: null },
    { index: 4, kind: 'done', number: null, ids: ['fstep-4:finished'], sentence: 'The model as the steps leave it.', picture: THUMBNAIL, step: { kind: 'step', step: 'fstep-4', moment: 'after' } },
  ];
}

/** A Fold provider with no Fold behind it: these cards, and a pull that records what it was asked for. */
function fakeProvider(listed: FoldBrowserCardsState = { status: 'ready', sequence: 'fold-1', cards: cards() }) {
  return {
    useCards: () => listed,
    pull: vi.fn<FoldBrowserProvider['pull']>(async () => 1),
    openFold: vi.fn(),
  } satisfies FoldBrowserProvider;
}

function render(provider: FoldBrowserProvider, anchor: DiagramPullAnchor = { kind: 'end' }) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      // As the app wraps it: the Join button's tooltip needs a provider.
      <TooltipProvider>
        <DiagramFoldBrowser state={{ anchor, opening: 7 }} style={DEFAULT_DIAGRAM_STYLE} provider={provider} />
      </TooltipProvider>
    )
  );
}

const text = () => host?.textContent ?? '';
const button = (label: string) =>
  [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
const options = () => [...(host?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
const press = (index: number, shiftKey = false) =>
  act(() => void options()[index]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey })));

describe('the Fold browser (D17)', () => {
  it('lists the sequence’s steps, the turns between them and Finished, in Fold’s words', () => {
    render(fakeProvider());
    expect(text()).toContain('Add from Fold');
    expect(options().map((option) => option.querySelector('span:nth-child(2)')?.textContent)).toEqual([
      'Step 1',
      'Turn',
      'Step 2',
      'Step 3',
      'Finished',
    ]);
    expect(text()).toContain('Valley fold in half.');
    // Each landed card is the step it adds, drawn as a Diagram card draws it, on its paper.
    expect(host?.querySelectorAll('img[data-pull-picture]')).toHaveLength(4);
    expect(host?.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,test-step');
    expect(options()[0]!.querySelector('[data-picture]')).not.toBeNull();
    expect(preview.asked).toContainEqual(REQUEST);
    // A step Fold has not folded yet cannot be chosen, and says why.
    expect(options()[3]!.getAttribute('aria-disabled')).toBe('true');
    expect(options()[3]!.title).toContain('can’t be added yet');
  });

  it('shows a step still replaying as loading, not as one that can’t be drawn', () => {
    render(fakeProvider());
    const replaying = options()[3]!;
    expect(replaying.querySelector('[data-picture-loading]')).not.toBeNull();
    expect(replaying.textContent).not.toContain('Can’t be drawn');
  });

  it('shows a landed step still being captured as loading, on the well’s own ground', () => {
    preview.result = undefined;
    render(fakeProvider());
    expect(options()[0]!.querySelector('[data-picture-loading]')).not.toBeNull();
    expect(options()[0]!.querySelector('[data-picture]')).toBeNull();
    expect(text()).not.toContain('Can’t be drawn');
  });

  it('says a step can’t be drawn when nothing will land: it broke, or the replay stopped', () => {
    render(fakeProvider({ status: 'ready', sequence: 'fold-1', cards: cards({ status: 'none' }) }));
    expect(options()[3]!.textContent).toContain('Can’t be drawn');
    expect(options()[3]!.querySelector('[data-picture-loading]')).toBeNull();
  });

  it('says a landed step can’t be drawn when its capture came to nothing', () => {
    preview.result = null;
    render(fakeProvider());
    expect(options()[0]!.textContent).toContain('Can’t be drawn');
    expect(options()[0]!.querySelector('[data-picture-loading]')).toBeNull();
  });

  it('adds what is chosen, in order, where it was opened for, through its provider', async () => {
    const provider = fakeProvider();
    render(provider);
    press(0);
    press(4);
    expect(button('Add 2 steps')).toBeTruthy();
    await act(async () => button('Add 2 steps')!.click());
    expect(provider.pull).toHaveBeenCalledWith(
      [
        { kind: 'step', step: 'fstep-1', moment: 'before' },
        { kind: 'step', step: 'fstep-4', moment: 'after' },
      ],
      { kind: 'end' },
      7
    );
  });

  it('offers the turn just before the first chosen step, and adds it with it unless told not to', async () => {
    const provider = fakeProvider();
    render(provider);
    press(2);
    expect(text()).toContain('With the turn before it');
    expect(options()[1]!.dataset.offered).toBeDefined();
    await act(async () => button('Add step')!.click());
    expect(provider.pull.mock.calls[0]![0]).toEqual([
      { kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } },
      { kind: 'step', step: 'fstep-3', moment: 'before' },
    ]);
  });

  it('marks the turn it offers in a solid line: on paper a dash is a valley fold', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/diagram/DiagramReferencesCard.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]*\[data-offered\][^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) expect(body, selector.trim()).not.toMatch(/dash|dott/);
  });

  it('chooses every step it can with Select all, a range with Shift', async () => {
    const provider = fakeProvider();
    render(provider);
    act(() => button('Select all')!.click());
    expect(text()).toContain('4 selected');
    act(() => button('Clear')!.click());
    press(0);
    press(2, true);
    expect(text()).toContain('3 selected');
  });

  it('says how to start when there is nothing to pull, and opens Fold', () => {
    const provider = fakeProvider({ status: 'empty' });
    render(provider);
    expect(text()).toContain('Fold a step in Fold');
    const open = [...(host?.querySelectorAll('button') ?? [])].filter((candidate) => candidate.textContent === 'Open Fold');
    act(() => open.at(-1)!.click());
    expect(provider.openFold).toHaveBeenCalledOnce();
  });

  describe('Merge symmetric steps', () => {
    const PLACE = 'fstep-3|fstep-4';
    /**
     * Steps 2 and 3 repeat each other — mirror images, or one the other
     * turned: one card while their place is joined, two while it is not, as
     * the app's provider lays them out (`foldMergeLayout`): the reader's
     * choice, else joined for a mirror image while the option is on.
     */
    function mergingProvider(kind: 'mirror' | 'turn' = 'mirror') {
      const separate = cards(THUMBNAIL).map((card) =>
        card.index === 3
          ? { ...card, step: { kind: 'step' as const, step: 'fstep-4', moment: 'before' as const } }
          : card.index === 2
            ? { ...card, join: { key: PLACE, kind } }
            : card
      );
      const merged: FoldBrowserCard[] = [
        separate[0]!,
        separate[1]!,
        {
          index: 2,
          kind: 'fold',
          number: 2,
          through: 3,
          ids: ['fstep-3', 'fstep-4'],
          merged: { kind, count: 2 },
          sentence: 'Valley fold on both sides.',
          picture: THUMBNAIL,
          step: { kind: 'step', step: 'fstep-3', through: 'fstep-4', moment: 'before' },
        },
        { ...separate[4]!, index: 3 },
      ];
      return {
        useCards: (choice: FoldMergeChoice): FoldBrowserCardsState => {
          const joined = choice.choices.get(PLACE) ?? (kind !== 'turn' && choice.mirrors);
          return {
            status: 'ready',
            sequence: 'fold-1',
            cards: joined ? merged : separate,
            mergeable: true,
            places: new Map([[PLACE, kind]]),
          };
        },
        pull: vi.fn<FoldBrowserProvider['pull']>(async () => 1),
        openFold: vi.fn(),
      } satisfies FoldBrowserProvider;
    }
    const toggle = () => host?.querySelector<HTMLInputElement>('label input[type="checkbox"]') ?? null;
    const titles = () => options().map((option) => option.querySelector('span:nth-child(2)')?.textContent);
    const labelled = (label: string) => host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;

    beforeEach(() => useSettingsStore.getState().setDiagramFoldMergePrecreases(true));

    it('is on by default, and draws mirror images as the one step they add', async () => {
      const provider = mergingProvider();
      render(provider);
      expect(toggle()).toMatchObject({ checked: true, disabled: false });
      expect(text()).toContain('Merge symmetric steps');
      expect(titles()).toEqual(['Step 1', 'Turn', 'Steps 2–3', 'Finished']);
      // A merged card is drawn as a stack of the steps it is.
      expect(options()[2]!.getAttribute('data-stack')).toBe('1');
      press(2);
      expect(button('Add step')).toBeTruthy();
      await act(async () => button('Add step')!.click());
      expect(provider.pull.mock.calls[0]![0]).toEqual([
        { kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } },
        { kind: 'step', step: 'fstep-3', through: 'fstep-4', moment: 'before' },
      ]);
    });

    it('lists the steps apart when turned off, and remembers it', () => {
      render(mergingProvider());
      act(() => toggle()!.click());
      expect(useSettingsStore.getState().diagramFoldMergePrecreases).toBe(false);
      expect(toggle()!.checked).toBe(false);
      expect(options()).toHaveLength(5);
      expect(text()).not.toContain('Steps 2–3');
    });

    it('splits a merged card into its steps, and joins them again', () => {
      render(mergingProvider());
      // Split presses nothing else: the card is not chosen.
      act(() => labelled('Split into 2 steps')!.click());
      expect(titles()).toEqual(['Step 1', 'Turn', 'Step 2', 'Step 3', 'Finished']);
      expect(options().some((option) => option.getAttribute('aria-selected') === 'true')).toBe(false);
      const join = labelled('Join step 2 and step 3')!;
      expect(join.getAttribute('aria-label')).toBe('Join step 2 and step 3');
      act(() => join.click());
      expect(titles()).toEqual(['Step 1', 'Turn', 'Steps 2–3', 'Finished']);
    });

    it('offers a turned copy apart, and draws it as one step only once joined', () => {
      render(mergingProvider('turn'));
      expect(titles()).toEqual(['Step 1', 'Turn', 'Step 2', 'Step 3', 'Finished']);
      act(() => labelled('Join step 2 and step 3')!.click());
      expect(titles()).toEqual(['Step 1', 'Turn', 'Steps 2–3', 'Finished']);
    });

    it('keeps what is chosen through a split: the merged card’s steps, each', () => {
      render(mergingProvider());
      press(2);
      act(() => labelled('Split into 2 steps')!.click());
      expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
        'false',
        'false',
        'true',
        'true',
        'false',
      ]);
      expect(button('Add 2 steps')).toBeTruthy();
    });

    it('is offered only when something on the path would merge, its choice still shown', () => {
      render(fakeProvider());
      expect(toggle()).toMatchObject({ checked: true, disabled: true });
      expect(toggle()!.closest('label')!.title).toContain('No steps on this path');
    });
  });

  it('fills an empty step with the first step, and says so', () => {
    const state = useWorkspaceStore.getState();
    const stepId = state.addDiagramStep()!;
    render(fakeProvider(), { kind: 'fill', stepId });
    press(0);
    press(2);
    expect(text()).toContain('Fill step 1');
    expect(button('Fill step 1 and add 1 after it')).toBeTruthy();
  });
});
