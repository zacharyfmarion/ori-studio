import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnKind } from '../../../lib/steps/turn';
import { StepCard, StepCardBadge } from './StepCard';
import { StepsGrid, type StepsGridDropTarget } from './StepsGrid';
import { TurnCard } from './TurnCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A sequence that is not a Diagram's: the grid knows its entries only by id and by which are turns. */
type Step = { id: string; text: string };
type Turn = TurnKind & { id: string; unknown?: unknown };
type Entry = Step | Turn;
const isTurn = (entry: Entry): entry is Turn => 'kind' in entry;

const entries: Entry[] = [
  { id: 'fold-1', text: 'Valley fold in half.' },
  { id: 'turn-1', kind: 'turn-over', axis: 'vertical' },
  { id: 'fold-2', text: 'Squash the flap.' },
  { id: 'turn-2', kind: 'rotate', rotate: { amount: 'half', direction: 'cw' }, unknown: { kind: 'spin' } },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

// Give the grid's virtualizer a viewport (`useVirtualStepRows`); jsdom otherwise measures every box as zero.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 100 : 1000;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(
  options: {
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    onDelete?: (id: string) => void;
    dropTarget?: StepsGridDropTarget | null;
    insert?: { label: string; onInsertBefore: (id: string) => void };
    append?: { label: string; onAppend: () => void };
  } = {}
) {
  if (!host) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  }
  const onSelect = options.onSelect ?? vi.fn();
  act(() =>
    root?.render(
      <StepsGrid<Step, Turn>
        entries={entries}
        isTurn={isTurn}
        label="Sequence"
        selectedId={options.selectedId ?? null}
        onSelect={onSelect}
        attributes={{ 'data-surface': 'test' }}
        dropTarget={options.dropTarget}
        insert={options.insert}
        append={options.append}
        renderCard={(slot, card) =>
          slot.kind === 'turn' ? (
            <TurnCard
              {...card}
              turn={slot.entry}
              between={slot.between}
              glyph={slot.entry.unknown === undefined ? 'data:image/svg+xml,%3Csvg%2F%3E' : null}
              onSelect={onSelect}
              onDelete={options.onDelete}
            />
          ) : (
            <StepCard
              {...card}
              id={slot.entry.id}
              label={`Fold ${slot.number}`}
              title={`Fold ${slot.number}`}
              kind={<StepCardBadge>Fold</StepCardBadge>}
              paper={false}
              instruction={slot.entry.text}
              onSelect={onSelect}
            >
              {null}
            </StepCard>
          )
        }
      />
    )
  );
  return onSelect;
}

const listbox = () => host!.querySelector<HTMLElement>('[role="listbox"]')!;
const options = () => [...host!.querySelectorAll<HTMLElement>('[role="option"]')];

describe('StepsGrid', () => {
  it('is one listbox of every entry, the steps numbered and the turns not, each named by where it stands', () => {
    render();
    expect(listbox().getAttribute('aria-label')).toBe('Sequence');
    // The surface's own mark, on the listbox.
    expect(listbox().dataset.surface).toBe('test');
    expect(options().map((option) => option.getAttribute('aria-label'))).toEqual([
      'Fold 1',
      'Turn over, side to side, between steps 1 and 2',
      'Fold 2',
      'Turn from a newer Ori Studio, after step 2',
    ]);
    expect(options().map((option) => option.dataset.stepId)).toEqual(['fold-1', 'turn-1', 'fold-2', 'turn-2']);
  });

  it('draws a turn’s glyph on the paper, and a newer build’s as a stand-in with no glyph', () => {
    render();
    const [, over, , newer] = options();
    expect(over!.dataset.turnKind).toBe('turn-over');
    expect(over!.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(over!.querySelector('[data-picture]')).not.toBeNull();
    expect(over!.textContent).toContain('No number');
    expect(over!.textContent).toContain('Between steps 1 and 2');
    expect(newer!.dataset.turnKind).toBe('locked');
    expect(newer!.querySelector('img')).toBeNull();
    expect(newer!.querySelector('[data-picture]')).toBeNull();
    expect(newer!.textContent).toContain('Made with a newer Ori Studio');
  });

  it('makes the selected card the tab stop, the first while none is, and reports presses', () => {
    const onSelect = render({ selectedId: 'fold-2' });
    expect(options().map((option) => [option.getAttribute('aria-selected'), option.tabIndex])).toEqual([
      ['false', -1],
      ['false', -1],
      ['true', 0],
      ['false', -1],
    ]);
    act(() => options()[1]!.click());
    expect(onSelect).toHaveBeenLastCalledWith('turn-1');
    act(() => listbox().click());
    expect(onSelect).toHaveBeenLastCalledWith(null);
    render();
    expect(options().map((option) => option.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('carries focus with the selection while focus is in the grid', () => {
    render({ selectedId: 'fold-1' });
    act(() => options()[0]!.focus());
    render({ selectedId: 'turn-2' });
    expect(document.activeElement).toBe(options()[3]);
  });

  it('adds nothing for a pointer to a sequence that cannot change', () => {
    render();
    expect(host!.querySelector('[data-insert-before]')).toBeNull();
    expect(host!.querySelector('[data-add-step-tile]')).toBeNull();
    expect(host!.querySelector('button[data-danger]')).toBeNull();
    // A slot for each entry, in the rows the grid mounts, and nothing after them.
    expect(listbox().querySelectorAll('[data-index] > *')).toHaveLength(entries.length);
  });

  it('offers the gap before every card and a tile after the last, with the surface’s words', () => {
    const onInsertBefore = vi.fn();
    const onAppend = vi.fn();
    const onSelect = render({
      insert: { label: 'Add a fold here', onInsertBefore },
      append: { label: 'Add fold', onAppend },
    });
    const gaps = [...host!.querySelectorAll<HTMLElement>('[data-insert-before]')];
    expect(gaps.map((gap) => [gap.dataset.insertBefore, gap.title])).toEqual(
      entries.map((entry) => [entry.id, 'Add a fold here'])
    );
    const tile = host!.querySelector<HTMLElement>('[data-add-step-tile]')!;
    expect(tile.textContent).toBe('Add fold');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    act(() => gaps[1]!.click());
    act(() => tile.click());
    expect(onInsertBefore).toHaveBeenCalledWith('turn-1');
    expect(onAppend).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    // Still only the entries are options.
    expect(options()).toHaveLength(entries.length);
  });

  it('marks where something dragged over it would land: a card, or the grid', () => {
    render({ dropTarget: { kind: 'card', id: 'turn-1' } });
    expect(options().map((option) => option.hasAttribute('data-drop-target'))).toEqual([false, true, false, false]);
    expect(listbox().hasAttribute('data-drop-target')).toBe(false);
    render({ dropTarget: { kind: 'grid' } });
    expect(options().some((option) => option.hasAttribute('data-drop-target'))).toBe(false);
    expect(listbox().hasAttribute('data-drop-target')).toBe(true);
  });

  it('puts a turn’s Delete over its corner only where it can be deleted', () => {
    const onDelete = vi.fn();
    const onSelect = render({ onDelete });
    const deletes = [...host!.querySelectorAll<HTMLButtonElement>('button[data-danger]')];
    expect(deletes.map((button) => [button.closest<HTMLElement>('[role="option"]')?.dataset.stepId, button.title])).toEqual([
      ['turn-1', 'Delete Turn'],
      ['turn-2', 'Delete Turn'],
    ]);
    expect(deletes[0]!.tabIndex).toBe(-1);
    act(() => deletes[1]!.click());
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('turn-2');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
