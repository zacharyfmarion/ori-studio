/**
 * Crease-pattern document slots.
 *
 * The app keeps more than one crease pattern live at once: the document the user
 * is editing in the Edit workspace, and — while a tutorial lesson is open — a
 * separate practice document. Each lives in a **slot**. A slot owns a kernel
 * handle (see `oristudioCpRuntime`) plus its own copy of every store field that
 * belongs to a document rather than to the app ({@link CpSlotScopedState}).
 *
 * Switching slots is cheap: both kernel documents stay allocated, and the store
 * swap is an assignment of objects already in memory. Nothing is serialized,
 * re-parsed, or freed.
 *
 * **The invariant that keeps this contained:** {@link enterCpDocumentSlot} is
 * called from route effects only. Nothing inside the editor — no panel, no
 * slice, no command — should mention a slot. If you find yourself reaching for
 * one there, the abstraction has leaked and the decision belongs in the route.
 */
import { useWorkspaceStore } from '../workspaceStore';
import {
  CP_SLOT_SCOPED_KEYS,
  type CpSlotScopedState,
  type CpDocumentSlotId,
  type WorkspaceState,
} from './types';
import { activeCpDocumentSlot, switchCpDocumentSlot } from './oristudioCpRuntime';
import { CP_DOCUMENT_SCOPED_KEYS } from './cpDocumentState';

const CP_SLOT_SCOPED_FIELDS = Object.keys(CP_SLOT_SCOPED_KEYS) as Array<
  keyof CpSlotScopedState
>;

/**
 * Two named sets of per-document fields exist, and they are not the same set:
 *
 *  - `CP_DOCUMENT_SCOPED_KEYS` — what must be **discarded** when a document is
 *    replaced, so nothing survives an open that belonged to the last document.
 *  - `CP_SLOT_SCOPED_KEYS` — what must **travel** when the foreground document
 *    changes, so two live documents cannot read each other's state.
 *
 * The slot set is the larger of the two: the viewport, the active tool, the
 * crease colour mode and `dirty` all belong to a document but must survive an
 * open, so they travel without being discarded. The containment is the invariant
 * worth enforcing, though — anything discarded on replace is by definition
 * per-document, so a field in the discard set that did *not* travel would leak
 * across slots.
 *
 * Asserted at compile time rather than in a test, so a field added to the
 * discard set (which happens on main independently of this feature) cannot land
 * without also being slotted.
 */
type DiscardedButNotSlotted = Exclude<
  (typeof CP_DOCUMENT_SCOPED_KEYS)[number],
  keyof CpSlotScopedState
>;
const _everyDiscardedFieldTravels: [DiscardedButNotSlotted] extends [never]
  ? true
  : ['discard-on-replace field missing from CP_SLOT_SCOPED_KEYS:', DiscardedButNotSlotted] = true;
void _everyDiscardedFieldTravels;

/**
 * Bundles for slots that are not in the foreground. The active slot's state
 * lives in the store itself, never here — so there is exactly one copy of any
 * document's state at any moment and no question of which is authoritative.
 */
const parkedBundles: Partial<Record<CpDocumentSlotId, CpSlotScopedState>> = {};

/**
 * The store's own initial values for every document-scoped field, captured once
 * from a pristine store rather than restated here. Restating them would be a
 * second source of truth that drifts silently the first time a slice changes an
 * initial value.
 */
let pristineBundle: CpSlotScopedState | null = null;

/**
 * Advances on every slot switch. In-flight async work captures this before
 * awaiting and compares afterwards, so a response that arrives after the user
 * has moved to another document is dropped instead of applied to the wrong one.
 *
 * This is the one hazard slots introduce that no type can catch, so the guard is
 * deliberately a single shared primitive rather than per-call-site cleverness.
 */
let slotGeneration = 0;

export function cpSlotGeneration(): number {
  return slotGeneration;
}

/** True when the generation captured before an await is still current. */
export function cpSlotGenerationIsCurrent(captured: number): boolean {
  return captured === slotGeneration;
}

/**
 * Record the store's pristine document-scoped state. Called once at store
 * creation, before anything can have loaded a document.
 */
export function rememberPristineCpDocumentState(state: WorkspaceState): void {
  pristineBundle ??= captureCpDocumentState(state);
}

/** Copy the document-scoped fields out of a store state. */
export function captureCpDocumentState(state: WorkspaceState): CpSlotScopedState {
  const bundle: Record<string, unknown> = {};
  for (const field of CP_SLOT_SCOPED_FIELDS) {
    bundle[field] = state[field];
  }
  // The key list is `keyof CpSlotScopedState` and is exhaustive by
  // construction (CP_SLOT_SCOPED_KEYS is a total map), so every field is
  // present — but that reasoning runs through a loop TypeScript can't follow.
  return bundle as unknown as CpSlotScopedState;
}

/** Write a document-scoped bundle back into the store. */
export function installCpDocumentState(bundle: CpSlotScopedState): void {
  useWorkspaceStore.setState(bundle as Partial<WorkspaceState>);
}

/**
 * Bring a slot to the foreground: park the outgoing document's state, re-point
 * the kernel runtime, and install the incoming document's state. A slot that has
 * never been entered starts from the store's pristine values, which leaves the
 * surface to self-provision — the same rule every other surface follows.
 *
 * No-ops when the slot is already active, so routes can call it unconditionally.
 */
export function enterCpDocumentSlot(slot: CpDocumentSlotId): void {
  const current = activeCpDocumentSlot();
  if (current === slot) return;

  parkedBundles[current] = captureCpDocumentState(useWorkspaceStore.getState());
  switchCpDocumentSlot(slot);
  slotGeneration += 1;

  const incoming = parkedBundles[slot] ?? pristineBundle;
  if (incoming) installCpDocumentState(incoming);
  delete parkedBundles[slot];
}

/**
 * Whether edits in the foreground document should mark the user's project
 * unsaved. `dirty` is project-wide (it covers the tree as well as the crease
 * pattern), so it is deliberately *not* slot-scoped; instead, an ephemeral slot
 * simply never sets it. A tutorial practice pattern is not part of the user's
 * project and can never be saved, so it has no business claiming there is
 * unsaved work.
 */
export function activeSlotTracksProjectDirty(): boolean {
  return activeCpDocumentSlot() === 'edit';
}

/** Test seam: forget every parked bundle and return to the edit slot. */
export function resetCpDocumentSlotsForTest(): void {
  for (const key of Object.keys(parkedBundles) as CpDocumentSlotId[]) {
    delete parkedBundles[key];
  }
  switchCpDocumentSlot('edit');
  slotGeneration = 0;
  pristineBundle = null;
}
