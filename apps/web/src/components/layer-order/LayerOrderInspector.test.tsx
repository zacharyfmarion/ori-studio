/**
 * The Layer order dialog's inspector column, as its boards draw it
 * (`Round3`'s A3, `Round4-States`, `Round5-Compound`'s A5): each state, found
 * by role and name, over the model's own fixtures
 * (`layer-order/model/layerOrderModel.fixtures.ts`), with what each control
 * sends back to the model.
 *
 * The fixture figure's faces read A to G by number; A–C, C–D and E–F are open.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { FaceLetters } from '../../layer-order/engine/faceIndex';
import {
  carried,
  changedSpots,
  commits,
  count,
  fits,
  lastOf,
  openFactsOf,
  opened,
  picked,
  play,
  position,
  sidesOf,
  SPOTS,
  type Played,
} from '../../layer-order/model/layerOrderModel.fixtures';
import { layerOrderReducer } from '../../layer-order/model/layerOrderReducer';
import { rowGroupsView } from '../../layer-order/model/layerOrderSelectors';
import type { LayerOrderAction, LayerOrderDialogState } from '../../layer-order/model/layerOrderState';
import { allByRole, byRole, queryByRole } from '../../test/roleQueries';
import { TooltipProvider } from '../ui/Tooltip';
import { layerOrderCopy } from './layerOrderInspectorCopy';
import { LayerOrderInspector } from './LayerOrderInspector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The fixture's letters: face k is the k-th letter. */
const LETTERS: FaceLetters = {
  faceCount: 61,
  inLetterOrder: Array.from({ length: 61 }, (_, face) => face),
  letterOf: (face) => (face < 26 ? String.fromCharCode(65 + face) : `A${String.fromCharCode(65 + face - 26)}`),
  faceOf: () => null,
  compare: (a, b) => a - b,
};

let host: HTMLDivElement;
let root: Root;
let sent: LayerOrderAction[];

beforeEach(() => {
  sent = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draw the inspector for `state`, sending what it dispatches to `sent` (and on to the reducer, when `live`). */
function draw(state: LayerOrderDialogState, { unlettered = false, live = false } = {}) {
  let now = state;
  const dispatch = (action: LayerOrderAction) => {
    sent.push(action);
    if (!live) return;
    now = layerOrderReducer(now, action).state;
    render();
  };
  const render = () =>
    act(() =>
      root.render(
        <TooltipProvider>
          <LayerOrderInspector
            state={now}
            dispatch={dispatch}
            copy={layerOrderCopy(i18n.t, 'en', LETTERS)}
            letters={LETTERS}
            hint={{ unlettered }}
          />
        </TooltipProvider>
      )
    );
  render();
  return { state: () => now };
}

const counted = (from: Played, total = count(9, 9, 24), at = position(4, 9)): LayerOrderDialogState =>
  play(from, { type: 'solutions_counted', generation: from.state.solutions.generation, by: { picture: 'front' }, count: total, position: at }).state;

const click = (element: Element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const key = (element: Element, keyName: string) =>
  act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true })));
/** The hint's two live regions, as the sentence names them for its description: the polite one, then the alert. */
const hintRegions = () => {
  const sentence = byRole(host, 'group', 'Add a constraint');
  return sentence
    .getAttribute('aria-describedby')!
    .split(' ')
    .map((id) => document.getElementById(id)!);
};
/** The hint line: its text, in whichever region holds it, and its Keep trying. */
const hint = () => hintRegions()[0]!.closest('[data-tone]') as HTMLElement;
/** Which region the hint speaks in: the alert for a danger reason, else the polite one. */
const hintRole = () => {
  const [polite, alert] = hintRegions();
  expect(polite!.getAttribute('role')).toBe('status');
  expect(alert!.getAttribute('role')).toBe('alert');
  return alert!.textContent ? 'alert' : polite!.textContent ? 'status' : null;
};
const button = (name: string | RegExp) => byRole(document.body, 'button', name);
const statusRegion = () => byRole(host, 'region', 'Solutions');
/** The status as drawn. */
const status = () => statusRegion().querySelector('[data-status-shown]')!;
/** The status as a screen reader hears it: the settled count only. */
const spoken = () => statusRegion().querySelector('[role="status"]')!;

describe('the status and its stepper', () => {
  it('counts the solutions, and steps through them in a stable order (A3)', () => {
    draw(counted(opened()));
    expect(status().textContent).toBe('9 pictures · 24 layer orders');
    expect(spoken().textContent).toBe('9 pictures · 24 layer orders');
    const stepper = byRole(host, 'group', 'Solution shown');
    expect(stepper.textContent).toBe('4 of 9');
    click(byRole(stepper, 'button', 'Next solution'));
    expect(sent).toEqual([{ type: 'step', direction: 'next' }]);
  });

  it('reads “at least N” while the count runs (Round4-States, counting)', () => {
    draw(counted(opened(), count(4, 4, 10, false), position(2, 4, false)));
    expect(status().textContent).toBe('At least 4 pictures · at least 10 layer orders');
    // The running number stays out of the live region: it says the count is running, once.
    expect(spoken().textContent).toBe('Counting solutions…');
    // Not "2 of 4+": until the count ends, the index counts the solutions found so far, not their rank (E9).
    expect(byRole(host, 'group', 'Solution shown').textContent).toBe('Solution 2');
  });

  it('keeps ‹ at the first found while the count runs, and waits there once it is final (E9)', () => {
    draw(counted(opened(), count(4, 4, 10, false), position(1, 4, false)));
    expect(byRole(host, 'group', 'Solution shown').textContent).toBe('Solution 1');
    expect(button('Previous solution').getAttribute('aria-disabled')).not.toBe('true');
    act(() => root.unmount());
    root = createRoot(host);
    draw(counted(opened(), count(4, 4, 10), position(1, 4)));
    expect(byRole(host, 'group', 'Solution shown').textContent).toBe('1 of 4');
    expect(button('Previous solution').getAttribute('aria-disabled')).toBe('true');
  });

  it('says a step that ran out calmly, with Keep trying (E9)', () => {
    const counting = counted(opened(), count(4, 4, 10, false), position(2, 4, false));
    const stepping = play(counting, { type: 'step', direction: 'next' });
    const { request } = lastOf(stepping.effects, 'step');
    draw(play(stepping.state, { type: 'stepped', request, facts: { verdict: 'timed_out' } }).state);
    expect(hint().textContent).toContain('Couldn’t find the next solution in time.');
    click(button('Keep trying'));
    expect(sent).toEqual([{ type: 'keep_trying' }]);
  });

  it('names the pictures and the layer orders when hidden layers tell orders apart (the owner, 2026-10-27)', () => {
    draw(counted(opened(), count(4, 4, 256), position(1, 4)));
    expect(status().textContent).toBe('4 pictures · 256 layer orders');
    expect(spoken().textContent).toBe('4 pictures · 256 layer orders');
    // The stepper still steps by picture; X-ray steps through every layer order.
    expect(byRole(host, 'group', 'Solution shown').textContent).toBe('1 of 4');
  });

  it('announces a count that stopped at its cap as its lower bound, once it has stopped', () => {
    const capped = { front: { n: 1000, exact: false }, back: { n: 1000, exact: false }, orders: { n: 1000, exact: false }, done: true };
    draw(counted(opened(), capped, position(2, 1000, false)));
    expect(status().textContent).toBe('At least 1000 solutions');
    expect(spoken().textContent).toBe('At least 1000 solutions');
  });

  it('names the solution shown, with no total, when the count is skipped (D7)', () => {
    const state = opened().state;
    draw({
      ...state,
      solutions: { ...state.solutions, runs: false, position: position(3, 3, false), positionBy: 'picture:front' },
    });
    expect(status().textContent).toBe('Solution 3');
    expect(byRole(host, 'group', 'Solution shown').textContent).toBe('');
    expect(button('Next solution')).toBeDefined();
  });

  it('counts layer orders with X-ray on (D5), and turns to success once one order is decided', () => {
    const xray = play(counted(opened(), count(9, 9, 24), position(4, 9)), { type: 'xray_set', on: true });
    draw(play(xray, { type: 'solutions_positioned', generation: 1, by: 'layer_order', position: position(7, 24) }).state);
    expect(status().textContent).toBe('24 layer orders');
    act(() => root.unmount());
    root = createRoot(host);
    draw(counted(opened(), count(1, 1, 1), position(1, 1)));
    expect(statusRegion().querySelector('[data-state]')?.getAttribute('data-state')).toBe('decided');
    expect(button('Next solution').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('the sentence builder', () => {
  it('opens on “Pick a face”, the subject slot active, Add waiting (A3)', () => {
    draw(counted(opened()));
    expect(button('Subject: pick a face').getAttribute('aria-current')).toBe('true');
    expect(button('Verb: in front of')).toBeDefined();
    expect(button('Objects: pick the subject first').getAttribute('aria-disabled')).toBe('true');
    expect(hint().textContent).toBe('Pick a face · 5 faces have choices');
    const add = button('Add constraint');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.title).toBe('Pick a face first');
    expect(button('Clear').getAttribute('aria-disabled')).toBe('true');
  });

  it('says a preview is running, and Add waits on it (Round4-States, a preview running)', () => {
    draw(picked(opened().state, 2, 0).state);
    expect(button('Subject: face C. Press to replace it')).toBeDefined();
    expect(hintRole()).toBe('status');
    expect(hint().textContent).toBe('Checking C in front of A…');
    expect(button('Add constraint').title).toBe('Checking C in front of A');
  });

  it('offers Add once the sentence fits, and Add sends it', () => {
    draw(fits(picked(opened().state, 2, 0)).state);
    const add = button('Add constraint');
    expect(add.getAttribute('aria-disabled')).toBeNull();
    expect(add.title).toBe('Add C in front of A');
    click(add);
    expect(sent).toContainEqual({ type: 'add' });
  });

  it('a clash being explained is danger at once, with its spinner (Round4-States)', () => {
    const asked = picked(opened().state, 2, 0);
    const preview = lastOf(asked.effects, 'preview');
    draw(play(asked, { type: 'previewed', request: preview.request, facts: { verdict: 'cant_fit', constraints: [0] } }).state);
    // One candidate that the creases alone refuse needs no explain: the reason is final.
    expect(hintRole()).toBe('alert');
    expect(hint().textContent).toBe('Can’t fit: the creases don’t allow C in front of A.');
  });

  it('names what a sentence clashes with, marks the row, and pointing at the reason strengthens the tints (Round3:473)', () => {
    const one = play(commits(play(fits(picked(opened().state, 2, 0)).state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5)));
    const asked = picked(one.state, 2, 3);
    const preview = lastOf(asked.effects, 'preview');
    const cantFit = play(asked, { type: 'previewed', request: preview.request, facts: { verdict: 'cant_fit', constraints: [0, 1] } });
    const explain = lastOf(cantFit.effects, 'explain');
    draw(cantFit.state);
    expect(hint().textContent).toBe('Can’t fit. Finding what it clashes with…');
    act(() => root.unmount());
    root = createRoot(host);
    draw(
      play(cantFit, {
        type: 'explained',
        request: explain.request,
        facts: { verdict: 'clash', constraints: [0, 1], faces: [0, 2, 3], minimal: true },
      }).state
    );
    expect(hint().textContent).toBe('Can’t fit: with the creases, C in front of D clashes with C in front of A.');
    expect(button('Add constraint').getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelector('li[data-mark="clash"]')).not.toBeNull();
    act(() => hint().dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    act(() => hint().dispatchEvent(new MouseEvent('pointerenter', { bubbles: false })));
    expect(sent).toContainEqual({ type: 'reason_hovered', on: true });
  });

  it('a check that ran out says so quietly, with Keep trying in the line (D8)', () => {
    const asked = picked(opened().state, 2, 0);
    const preview = lastOf(asked.effects, 'preview');
    draw(play(asked, { type: 'previewed', request: preview.request, facts: { verdict: 'timed_out' } }).state);
    expect(hint().textContent).toBe('Couldn’t check C in front of A in time.Keep trying');
    expect(button('Add constraint').getAttribute('aria-disabled')).toBe('true');
    click(byRole(hint(), 'button', 'Keep trying'));
    expect(sent).toEqual([{ type: 'keep_trying' }]);
  });

  it('holds several objects, each a chip that removes it, and Add says “Add constraints” (A5, D21)', () => {
    const two = play(opened(), { type: 'face_picked', face: 2, origin: 'pattern' }, { type: 'face_picked', face: 3, origin: 'folded' }, { type: 'face_picked', face: 0, origin: 'folded' });
    draw(fits(two, 7, SPOTS, changedSpots()).state);
    expect(button('Objects: A, D. Choose more from a list')).toBeDefined();
    expect(hint().textContent).toBe('Pick more faces to add them, or a picked face to remove it.');
    expect(button('Add constraints').getAttribute('aria-disabled')).toBeNull();
    click(button('Remove D'));
    click(button('Clear the objects'));
    expect(sent).toEqual([
      { type: 'object_removed', face: 3 },
      { type: 'slot_cleared', slot: 'object' },
    ]);
  });

  it('keeps the focus in the dialog when a chip or a slot’s × goes from the keyboard', () => {
    const two = play(opened(), { type: 'face_picked', face: 2, origin: 'pattern' }, { type: 'face_picked', face: 3, origin: 'folded' }, { type: 'face_picked', face: 0, origin: 'folded' });
    draw(fits(two, 7, SPOTS, changedSpots()).state, { live: true });
    // A chip removed: the next chip takes the focus, and after the last, the object field.
    act(() => button('Remove A').focus());
    click(button('Remove A'));
    expect(document.activeElement).toBe(button('Remove D'));
    click(button('Remove D'));
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Objects:/);
    // The subject's ×: the subject slot itself.
    act(() => button('Clear C from the subject').focus());
    click(button('Clear C from the subject'));
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Subject:/);
  });

  it('opens no face menu that was asked for while it could not open', () => {
    draw(opened().state, { live: true });
    key(button('Objects: pick the subject first'), 'Enter');
    expect(queryByRole(document.body, 'menu', /^Objects for/)).toBeNull();
    // The subject picked from its menu: the objects' menu does not open by itself.
    key(button('Subject: pick a face'), 'Enter');
    click(byRole(byRole(document.body, 'menu', 'Subjects'), 'menuitemradio', 'Face C'));
    expect(button(/^Subject: face C/)).toBeDefined();
    expect(queryByRole(document.body, 'menu', /^Objects for/)).toBeNull();
  });

  it('asks for the tinted faces past the label cap, and to zoom in when they have no letters (D7)', () => {
    const pairs = Uint32Array.from(Array.from({ length: 60 }, (_, k) => [0, k + 1]).flat());
    const many = play(opened(openFactsOf({ faces: 61, openPairs: pairs, frontUp: new Uint8Array(61), stacks: sidesOf([Array.from({ length: 61 }, (_, f) => f)]) })), { type: 'face_picked', face: 0, origin: 'pattern' });
    draw(many.state);
    expect(hint().textContent).toBe('Pick one of the 60 tinted faces');
    act(() => root.unmount());
    root = createRoot(host);
    draw(many.state, { unlettered: true });
    expect(hint().textContent).toBe('Pick one of the 60 tinted faces. Zoom in to see their letters.');
  });

  it('opens on the verb picked, previews the verb under the focus, and lets go as the pointer leaves or it closes (Round3:455-457, 893, 929)', async () => {
    draw(picked(opened().state, 2, 0).state);
    key(button('Verb: in front of'), 'Enter');
    const menu = byRole(document.body, 'menu', 'Verb');
    expect(allByRole(menu, 'menuitemradio').map((row) => row.textContent)).toEqual(['in front of', 'behind']);
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    // From the keyboard it opens on the verb already picked, and previews nothing on the way.
    expect(document.activeElement).toBe(byRole(menu, 'menuitemradio', 'in front of'));
    expect(sent.filter((action) => action.type === 'verb_pointed')).toEqual([]);
    act(() => byRole(menu, 'menuitemradio', 'behind').focus());
    expect(sent).toContainEqual({ type: 'verb_pointed', verb: 'behind' });
    act(() => menu.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })));
    act(() => menu.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false })));
    expect(sent.at(-1)).toEqual({ type: 'verb_pointed', verb: null });
    key(byRole(menu, 'menuitemradio', 'behind'), 'Escape');
    expect(queryByRole(document.body, 'menu', 'Verb')).toBeNull();
    expect(sent.at(-1)).toEqual({ type: 'verb_pointed', verb: null });
  });

  it('offers the faces by letter from the keyboard: a subject from a list, objects from checkboxes that stay open (A5)', () => {
    const { state } = draw(counted(opened()), { live: true });
    key(button('Subject: pick a face'), 'Enter');
    const subjects = byRole(document.body, 'menu', 'Subjects');
    expect(allByRole(subjects, 'menuitemradio').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Face A',
      'Face C',
      'Face D',
      'Face E',
      'Face F',
    ]);
    click(byRole(subjects, 'menuitemradio', 'Face C'));
    expect(state().sentence.subject).toBe(2);
    expect(state().sentence.subjectOrigin).toBe('menu');

    key(button('Objects: pick faces C overlaps'), 'Enter');
    const objects = byRole(document.body, 'menu', 'Objects for C');
    click(byRole(objects, 'menuitemcheckbox', 'Face D'));
    // A checkbox set: the menu stays open for the next.
    const still = byRole(document.body, 'menu', 'Objects for C');
    expect(byRole(still, 'menuitemcheckbox', 'Face D').getAttribute('aria-checked')).toBe('true');
    click(byRole(still, 'menuitemcheckbox', 'Face A'));
    expect(state().sentence.objects).toEqual([0, 3]);
    expect(state().sentence.objectPicks.map((pick) => pick.origin)).toEqual(['menu', 'menu']);
  });

  it('lights a slot’s faces while the pointer is on the slot, not on its menu, so a menu closing under the pointer leaves none lit', () => {
    const { state } = draw(picked(opened().state, 2, 0).state, { live: true });
    const over = (element: Element, from: Element | null = null) =>
      act(() => element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: from })));
    const slot = button(/^Subject: face C/);
    key(slot, 'Enter');
    const face = byRole(byRole(document.body, 'menu', 'Subjects'), 'menuitemradio', 'Face A');
    // The menu, portalled out of the slot, is reached from elsewhere: the slot is not pointed at.
    over(face);
    expect(state().hover.slot).toBeNull();
    over(slot, face);
    expect(state().hover.slot).toBe('subject');
    // From the slot onto its menu: off the slot, so the menu closing under the pointer leaves nothing lit.
    over(face, slot);
    expect(state().hover.slot).toBeNull();
    click(face);
    expect(queryByRole(document.body, 'menu', 'Subjects')).toBeNull();
    expect(state().hover.slot).toBeNull();
  });

  it('is inert, with the reason in danger, while saved rows clash (Round4-States, the clashing set)', () => {
    const facts = openFactsOf({
      restore: {
        outcome: { kind: 'clash', constraints: [0, 1] },
        carried: [
          carried({ index: 0, status: { status: 'clashing' }, subject: 4, object: 5, constraint: [4, 5, 1] }),
          carried({ index: 1, status: { status: 'clashing' }, subject: 5, object: 4, constraint: [5, 4, 1] }),
        ],
      },
    });
    draw(opened(facts, { hasRecord: true }).state);
    expect(status().textContent).toBe('0 solutions');
    expect(statusRegion().querySelector('[data-state]')?.getAttribute('data-state')).toBe('danger');
    expect(hintRole()).toBe('alert');
    // F shows its back from the front: E on F's front side is behind it, as the list reads.
    expect(hint().textContent).toBe('Can’t fit: with the new creases, E behind F clashes with F in front of E. Remove one to apply.');
    expect(button('Subject: pick a face').getAttribute('aria-disabled')).toBe('true');
    expect(host.querySelectorAll('li[data-mark="clash"]')).toHaveLength(2);
  });
});

describe('the constraints list', () => {
  /** Opened, then C in front of A and D added as one sentence. */
  function compound(): Played {
    const two = play(opened(), { type: 'face_picked', face: 2, origin: 'pattern' }, { type: 'face_picked', face: 0, origin: 'folded' }, { type: 'face_picked', face: 3, origin: 'folded' });
    return commits(play(fits(two, 7, SPOTS, changedSpots()).state, { type: 'add' }), Uint32Array.of(4, 5));
  }

  it('is empty, with its sentence, until a constraint is added (A3)', () => {
    draw(counted(opened()));
    expect(byRole(host, 'region', 'Constraints')).toBeDefined();
    expect(host.textContent).toContain('None yet. Each constraint you add is listed here as its sentence, in the order made.');
    expect(button('Undo').getAttribute('aria-disabled')).toBe('true');
    expect(button('Clear all').getAttribute('aria-disabled')).toBe('true');
  });

  it('lists one row per subject and verb, with a trash for the whole row and no × per object (A5, D21)', () => {
    const { state } = compound();
    draw(state);
    expect(byRole(host, 'region', 'Constraints · 2')).toBeDefined();
    const row = button('C in front of A, D');
    expect(row.title).toBe('Put C in the builder');
    // Your words after trying it (2026-10-26): no individual × in a row of several objects.
    expect(queryByRole(host, 'button', 'Remove C in front of A')).toBeNull();
    expect(queryByRole(host, 'button', 'Remove C in front of D')).toBeNull();
    const item = row.closest('li')!;
    expect(allByRole(item, 'button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'C in front of A, D',
      'Remove C in front of A, D',
    ]);
    // The objects read with a comma right after each but the last.
    expect(item.textContent).toBe('Cin front ofA,D');
    click(row);
    click(button('Remove C in front of A, D'));
    expect(sent).toEqual([
      { type: 'row_clicked', key: expect.any(String) },
      { type: 'row_removed', key: (sent[0] as { key: string }).key },
    ]);
  });

  it('keeps the focus in the list when a row goes from the keyboard', () => {
    draw(compound().state);
    // The last row's trash: Undo takes the focus.
    act(() => button('Remove C in front of A, D').focus());
    click(button('Remove C in front of A, D'));
    expect(document.activeElement).toBe(button('Undo'));
    // A pointer's press keeps nothing: no focus moves, so no tooltip opens.
    const trash = button('Remove C in front of A, D');
    act(() => trash.focus());
    act(() => trash.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    expect(document.activeElement).toBe(trash);
  });

  it('names Undo’s key in its tooltip, as the registry resolves it', async () => {
    draw(compound().state);
    act(() => button('Undo').focus());
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(byRole(document.body, 'tooltip', /^Undo \(/).textContent).toMatch(/^Undo \(.*Z\)$/);
  });

  it('lights a row’s faces while it is pointed at, focused or pressed (D6)', () => {
    draw(compound().state);
    const row = button('C in front of A, D');
    act(() => row.focus());
    expect(sent.at(-1)).toMatchObject({ type: 'row_hovered' });
    act(() => row.blur());
    expect(sent.at(-1)).toEqual({ type: 'row_hovered', key: null });
    const item = row.closest('li')!;
    act(() => item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })));
    expect(sent.at(-1)).toMatchObject({ type: 'row_hovered', key: expect.any(String) });
  });

  it('says Undo waits while a change is in flight, not that there is nothing to undo', async () => {
    const { state } = compound();
    // The row's trash: its commit is in flight.
    const removing = play(state, { type: 'row_removed', key: rowGroupsView(state)[0]!.key });
    draw(removing.state);
    expect(button('Undo').getAttribute('aria-disabled')).toBe('true');
    act(() => button('Undo').focus());
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(byRole(document.body, 'tooltip', /^Undo waits/).textContent).toBe('Undo waits for the change in progress');
  });

  it('undoes, redoes and clears all from its head', () => {
    const { state } = compound();
    draw(state);
    expect(button('Undo').getAttribute('aria-disabled')).toBeNull();
    click(button('Undo'));
    click(button('Clear all'));
    expect(sent).toEqual([{ type: 'undo' }, { type: 'clear_all' }]);
  });

  it('dims a saved row that is not applied, with its reason; a face that no longer exists has no letter (Round4-States)', () => {
    const facts = openFactsOf({
      constraints: [[2, 0, 1]],
      restore: {
        outcome: { kind: 'applied' },
        carried: [
          carried({ index: 1, status: { status: 'ambiguous' }, subject: 4, object: 5, objectState: 'ambiguous', constraint: null }),
          carried({ index: 2, status: { status: 'gone', cause: 'face_gone' }, subject: null, subjectState: 'gone', object: 3, constraint: null }),
        ],
      },
    });
    draw(opened(facts, { hasRecord: true }).state);
    const split = button('E behind F');
    expect(split.closest('li')?.getAttribute('data-mark')).toBe('not_applied');
    expect(split.title).toBe('Not applied: a new crease split F, so this could mean either part.');
    const gone = button('A face that no longer exists behind D');
    expect(gone.title).toBe('Not applied: the face behind D no longer exists.');
    expect(gone.closest('li')?.querySelector('[data-gone]')?.textContent).toBe('');
    // Inside another sentence, it is a clause.
    expect(button('Remove a face that no longer exists behind D')).toBeDefined();
  });

  it('names an object that no longer exists as it was ordered, since its side went with it', () => {
    const facts = openFactsOf({
      restore: {
        outcome: { kind: 'applied' },
        carried: [
          carried({ index: 0, status: { status: 'gone', cause: 'face_gone' }, subject: 3, object: null, objectState: 'gone', constraint: null }),
        ],
      },
    });
    draw(opened(facts, { hasRecord: true }).state);
    expect(button('D against a face that no longer exists').title).toBe('Not applied: the face D was ordered against no longer exists.');
  });
});
