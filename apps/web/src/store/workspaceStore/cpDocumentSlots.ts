/**
 * Crease-pattern document slots.
 *
 * The app keeps more than one crease pattern live at once: the document the user
 * is editing in the Edit workspace, and — while a tutorial lesson is open — a
 * separate practice document. Each lives in a **slot**. A slot owns a kernel
 * handle (see `oristudioCpRuntime`) plus its own copy of every store field that
 * belongs to a document rather than to the app ({@link CpDocumentScopedState}).
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
  CP_DOCUMENT_SCOPED_KEYS,
  type CpDocumentScopedState,
  type CpDocumentSlotId,
  type WorkspaceState,
} from './types';
import { activeCpDocumentSlot, switchCpDocumentSlot } from './oristudioCpRuntime';

const CP_DOCUMENT_SCOPED_FIELDS = Object.keys(CP_DOCUMENT_SCOPED_KEYS) as Array<
  keyof CpDocumentScopedState
>;

/**
 * Bundles for slots that are not in the foreground. The active slot's state
 * lives in the store itself, never here — so there is exactly one copy of any
 * document's state at any moment and no question of which is authoritative.
 */
const parkedBundles: Partial<Record<CpDocumentSlotId, CpDocumentScopedState>> = {};

/**
 * The store's own initial values for every document-scoped field, captured once
 * from a pristine store rather than restated here. Restating them would be a
 * second source of truth that drifts silently the first time a slice changes an
 * initial value.
 */
let pristineBundle: CpDocumentScopedState | null = null;

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
export function captureCpDocumentState(state: WorkspaceState): CpDocumentScopedState {
  const bundle: Record<string, unknown> = {};
  for (const field of CP_DOCUMENT_SCOPED_FIELDS) {
    bundle[field] = state[field];
  }
  // The key list is `keyof CpDocumentScopedState` and is exhaustive by
  // construction (CP_DOCUMENT_SCOPED_KEYS is a total map), so every field is
  // present — but that reasoning runs through a loop TypeScript can't follow.
  return bundle as unknown as CpDocumentScopedState;
}

/** Write a document-scoped bundle back into the store. */
export function installCpDocumentState(bundle: CpDocumentScopedState): void {
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
