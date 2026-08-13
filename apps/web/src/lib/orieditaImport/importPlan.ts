import {
  SHORTCUT_DEFINITIONS,
  classifyReservedKey,
  findShortcutShadowing,
  getResolvedShortcuts,
  getShortcutDefinition,
  keyChordEquals,
  isShortcutBindable,
  shortcutIdForOrieditaAction,
  shortcutKeepsDefaultChords,
  shortcutMayDecline,
  type KeyChord,
  type ShortcutActionId,
  type ShortcutDefaultsSource,
  type ShortcutDefinition,
  type ShortcutOverrides,
  type ShortcutResolution,
  type ShortcutScope,
  type ShortcutShadowing,
} from '../../keyboard/shortcuts';
import type { JavaPropertyValue } from './javaProperties';
import { parseOrieditaKeyStrokeStrict, type KeyStrokeRejectReason } from './parseKeyStroke';

/**
 * Turn an Oriedita `hotkey.properties` into a reviewable list of "this key would
 * become that binding" rows, plus the override set applying them produces.
 *
 * An import carries the user's *own* edits and nothing else. `hotkey.properties`
 * is a sparse delta over upstream's jar defaults, and those defaults are the
 * business of the `oriedita` defaults source in `keyboard/shortcuts.ts` — a
 * standing preference, not something to smuggle in through a file picker.
 *
 * Nothing here touches the store. The plan is the thing the import dialog shows
 * *before* anything changes, so every rejection has to be a row with a reason —
 * a hotkey that vanishes without explanation is the exact failure this feature
 * exists to prevent.
 */

export type OrieditaImportSkipReason =
  /** Present with an empty value — see {@link collectKeyStrokes}. */
  | 'ambiguous-empty'
  /** No Ori Studio definition claims this `upstreamAction`. */
  | 'unmapped-action'
  /** `parseKeyStroke` rejected it; `detail.rejectReason` says which way. */
  | 'unparseable'
  /** The browser owns the chord (`classifyReservedKey`). */
  | 'reserved-chord'
  /** Another binding resolves to the same chord; `detail.shadowing` names it. */
  | 'shadowed'
  /** The target cannot hold an override at all. */
  | 'action-not-bindable'
  /** A menu-scope target whose key the native accelerator cannot express. */
  | 'menu-accelerator-unsupported';

export type OrieditaImportOutcome =
  | { readonly kind: 'apply'; readonly chord: KeyChord }
  | { readonly kind: 'skip'; readonly reason: OrieditaImportSkipReason };

export interface OrieditaImportShadowing {
  readonly actionId: ShortcutActionId;
  readonly label: string;
  readonly scope: ShortcutScope;
  /**
   * Which of the two the dispatcher would reach. Equal to the row's own
   * `shortcutId` means the import would take the chord *away* from the other
   * binding; anything else means the imported binding would be the dead one.
   * Either way the row is skipped, but the preview needs different words.
   */
  readonly winnerId: ShortcutActionId;
}

export interface OrieditaImportRowDetail {
  /**
   * Chords the target holds today that applying this row would drop. Oriedita
   * binds one chord per action while ours may hold several — `edit.delete` has
   * both Delete and Backspace — and an applied row replaces the whole list, so
   * the preview has to be able to say what goes away.
   */
  readonly replacedChords: readonly KeyChord[];
  /**
   * True when the target already resolves to exactly this chord, so applying the
   * row changes nothing the user would notice.
   *
   * Only ever set on an `apply` row, and the preview must not count these under
   * "will change": on a clean profile most of Oriedita's defaults already agree
   * with ours, which had the heading claim 16 changes for 5 real ones and
   * inflated the analytics count by the same factor.
   */
  readonly alreadyMatches?: boolean;
  /** Only on `unparseable`. */
  readonly rejectReason?: KeyStrokeRejectReason;
  /**
   * The other action holding this chord. Present in two different situations, so
   * read it together with the row's outcome:
   *
   * - outcome `skip`/`shadowed` — the other action wins outright and this
   *   binding was dropped.
   * - outcome `apply` — the other action is a `simulator` binding, which only
   *   enters the stack while a simulation owns the keyboard. The import stands;
   *   the chord simply does double duty, and the preview should say so rather
   *   than presenting it as a conflict.
   */
  readonly shadowing?: OrieditaImportShadowing;
  /**
   * Set on a `shadowed` row whose blocker may be unbound: what "Use anyway"
   * would cost. Adding this row's `shortcutId` to {@link
   * OrieditaImportPlanInput.allowEvictionFor} re-plans with exactly that removal
   * permitted.
   *
   * Absent means there is no offer to make — the blocker is one of the bindings
   * {@link isSharedByDesign} protects, or Undo/Redo, or something this same
   * import is already rebinding. Offering a "Use anyway" that then does nothing
   * would be worse than the dead end it replaces.
   */
  readonly evictionOffer?: OrieditaImportEviction;
}

export interface OrieditaImportRow {
  readonly orieditaAction: string;
  /** Null together with `label` and `scope` when we have no counterpart. */
  readonly shortcutId: ShortcutActionId | null;
  readonly label: string | null;
  readonly scope: ShortcutScope | null;
  /** The raw Java keystroke, or `''` for a present-but-empty entry. */
  readonly sourceKeyStroke: string;
  readonly outcome: OrieditaImportOutcome;
  readonly detail: OrieditaImportRowDetail;
}

export interface OrieditaImportPlan {
  readonly rows: readonly OrieditaImportRow[];
  /**
   * Bindings this plan removes, one per approved row's chain. Each also appears
   * in `overrides` as an explicit `null`, and this is the list the preview shows
   * under "will be unbound" so a removal is never a surprise.
   */
  readonly evictions: readonly OrieditaImportEviction[];
  /**
   * The overrides this import contributes, containing exactly the `apply` rows.
   * Merge it over the existing set rather than replacing — it says nothing about
   * actions the archive never mentioned.
   */
  readonly overrides: ShortcutOverrides;
}

/**
 * One shortcut the import would take away, so the preview can ask before any of
 * it happens.
 *
 * Eviction exists because the import otherwise only ever *adds*. An Ori Studio
 * action holding a chord that the archive gives to something else — and that
 * Oriedita has no binding for at all, so nothing ever moves it — blocks the
 * import permanently, and blocks whatever is queued behind it. Measured chain:
 * radial snapping holds `R`, so Mirror Line cannot reach `R`, so it keeps `M`,
 * so Mountain cannot reach `M`. One Ori Studio-only tool jams two Oriedita keys.
 */
export interface OrieditaImportEviction {
  /** The binding that gives up its chord. */
  readonly evictedId: ShortcutActionId;
  readonly evictedLabel: string;
  /** The chord it loses. */
  readonly chord: KeyChord;
  /** The imported action that takes it. */
  readonly takenById: ShortcutActionId;
  readonly takenByLabel: string;
}

export interface OrieditaImportPlanInput {
  /** As parsed by `parseJavaProperties`. */
  readonly hotkeys: ReadonlyMap<string, JavaPropertyValue>;
  /** The user's existing overrides, which decide what a row would displace. */
  readonly currentOverrides?: ShortcutOverrides;
  /**
   * The layout those overrides sit on. An import lands on whichever keyboard the
   * user is running, so what counts as a collision — and as already matching —
   * has to be asked of that one.
   */
  readonly defaultsSource?: ShortcutDefaultsSource;
  /**
   * Rows the user has approved an unbind for, named by the row's `shortcutId`.
   *
   * Empty by default: taking a binding away is a different thing to agree to
   * than adding one, so the plan is built without it first, each blocked row
   * carries `detail.evictionOffer`, and the dialog re-plans with the one row the
   * user said yes to.
   */
  readonly allowEvictionFor?: ReadonlySet<ShortcutActionId>;
}

/**
 * The keys `acceleratorKey` in `menus/nativeMenu.ts` knows how to name. Its
 * default branch passes anything else through verbatim, so an imported
 * `arrowleft` on a menu action becomes the accelerator string `CmdOrCtrl+arrowleft`
 * — which Tauri cannot parse, and which fails the whole native menu build rather
 * than just that item.
 */
const MENU_ACCELERATOR_NAMED_KEYS: ReadonlySet<string> = new Set([
  'backspace',
  'delete',
  'enter',
  'space',
  'escape',
  'tab',
]);

function isMenuAcceleratorExpressible(key: string): boolean {
  return key.length === 1 || /^f\d+$/u.test(key) || MENU_ACCELERATOR_NAMED_KEYS.has(key);
}



/**
 * Whether an override may name this action at all.
 *
 * Overrides bypass every invariant `shortcutRegistry.test.ts` enforces on the
 * *default* table, so the two rules that table encodes have to be re-applied
 * here: a chord on a not-yet-implemented action does nothing, and a chord on an
 * action with no button selects a tool the rail cannot show as active.
 *
 * `edit.undo` / `edit.redo` are unbindable for a different reason —
 * `getResolvedShortcuts` *merges* their overrides with the defaults instead of
 * replacing, so an import could only ever add a second chord to Undo, never move
 * it. Claiming otherwise in the preview would be a lie.
 */
function bindabilityRejection(definition: ShortcutDefinition): 'action-not-bindable' | null {
  // The rule itself lives in the registry, so capture in Settings and this
  // import cannot answer it differently — they did, and capture would destroy a
  // working binding to assign a not-implemented stub.
  return isShortcutBindable(definition.id) ? null : 'action-not-bindable';
}

interface OrieditaKeyStrokeEntry {
  readonly action: string;
  /** Null means present-but-empty; absent actions never reach here. */
  readonly keyStroke: string | null;
}

/**
 * The (action, keystroke) pairs the archive is an opinion about, in file order.
 *
 * An empty value is never an unbind: Oriedita writes `""` from both the Clear
 * button and the per-hotkey restore-default button, and the latter does so for
 * the 198 of 232 actions whose jar default is unbound — so reading it as "unbind
 * this" would mass-erase Ori Studio's own layout. Reading it as the jar default
 * would be just as wrong in the other direction, re-binding a key the user may
 * have deliberately cleared. It is reported and not acted on.
 */
function collectKeyStrokes(
  hotkeys: ReadonlyMap<string, JavaPropertyValue>
): OrieditaKeyStrokeEntry[] {
  return [...hotkeys].map(([action, value]) => ({
    action,
    keyStroke: value.kind === 'value' ? value.value : null,
  }));
}

/** The keyboard an import lands on: the active layout plus what the user changed. */
interface PlanResolution extends ShortcutResolution {
  readonly overrides: ShortcutOverrides;
}

interface RowBase {
  readonly orieditaAction: string;
  readonly shortcutId: ShortcutActionId | null;
  readonly label: string | null;
  readonly scope: ShortcutScope | null;
  readonly sourceKeyStroke: string;
}

type Draft =
  | { readonly kind: 'settled'; readonly row: OrieditaImportRow }
  | {
      readonly kind: 'candidate';
      readonly base: RowBase;
      readonly shortcutId: ShortcutActionId;
      readonly chord: KeyChord;
    };

function settled(
  base: RowBase,
  reason: OrieditaImportSkipReason,
  detail: Partial<OrieditaImportRowDetail> = {}
): Draft {
  return {
    kind: 'settled',
    row: {
      ...base,
      outcome: { kind: 'skip', reason },
      detail: { replacedChords: [], ...detail },
    },
  };
}

/**
 * Everything decidable about one row on its own, in a fixed order: what the
 * action *is* before what its keystroke says, so a row about an unbindable
 * action reports that rather than a parse detail the user cannot act on.
 * Shadowing is deliberately absent — it depends on the rest of the plan.
 *
 * `current` is needed for the already-matches check below: what counts as "no
 * change" is what the user resolves to *now*, not what the registry ships.
 */
function draftRow(entry: OrieditaKeyStrokeEntry, current: PlanResolution): Draft {
  const shortcutId = shortcutIdForOrieditaAction(entry.action);
  const definition = shortcutId ? getShortcutDefinition(shortcutId) : undefined;
  const base: RowBase = {
    orieditaAction: entry.action,
    shortcutId: definition ? definition.id : null,
    label: definition ? definition.label : null,
    scope: definition ? definition.scope : null,
    sourceKeyStroke: entry.keyStroke ?? '',
  };

  if (entry.keyStroke === null) return settled(base, 'ambiguous-empty');
  if (!definition) return settled(base, 'unmapped-action');

  const parsed = parseOrieditaKeyStrokeStrict(entry.keyStroke);
  if (!parsed.ok) return settled(base, 'unparseable', { rejectReason: parsed.reason });

  /*
   * Nothing to do beats any refusal.
   *
   * Checked ahead of bindability on purpose. Undo and Redo cannot take an
   * imported chord, but an Oriedita user's Undo is overwhelmingly Cmd+Z — the
   * same chord we already use — and answering "this action cannot take an
   * imported shortcut" for a binding that is *identical* to theirs reads as a
   * failure when in truth the keyboard already matches. Real exports hit this:
   * a file with four customizations had two of them here.
   */
  const existing = getResolvedShortcuts(definition.id, current);
  const alreadyMatches = existing.length === 1 && keyChordEquals(existing[0], parsed.chord);

  // Only the *bindability* refusal is waived — the row still goes through
  // shadowing like any other. Returning it settled here skipped that, and
  // `v_del_allAction` slipped past: its target already holds Mod+Shift+V, but the
  // crease-pattern twin outranks it, so the row claimed an action that never
  // fires. Nothing to change is not the same as nothing to check.
  const bindability = alreadyMatches ? null : bindabilityRejection(definition);
  if (bindability) return settled(base, bindability);

  if (classifyReservedKey(parsed.chord) === 'hard-reserved') {
    return settled(base, 'reserved-chord');
  }
  if (definition.scope === 'global' && !isMenuAcceleratorExpressible(parsed.chord.key)) {
    return settled(base, 'menu-accelerator-unsupported');
  }

  return { kind: 'candidate', base, shortcutId: definition.id, chord: parsed.chord };
}

function shadowingRecord(shadowing: ShortcutShadowing): OrieditaImportShadowing {
  return {
    actionId: shadowing.definition.id,
    label: shadowing.definition.label,
    scope: shadowing.definition.scope,
    winnerId: shadowing.winnerId,
  };
}

/**
 * Every claimant that may not answer a chord silenced, so a shadow check can ask
 * what the chord does in the stack the user is in the rest of the time. Two
 * kinds: `simulator` bindings, in the stack only while a simulation owns the
 * keyboard, and viewport bindings that {@link shortcutMayDecline}, in the stack
 * always but handing the chord on when they do not apply.
 *
 * `findShortcutShadowing` reports the single highest-precedence other claimant.
 * When that is one of these it answers `conditional` and stops — and anything
 * claiming the same chord *below* it is invisible. That hidden claimant is not
 * conditional at all: `viewport` always precedes `crease-pattern`, and within one
 * scope registry order decides, so it swallows the chord whenever no simulation
 * owns the keyboard, which is nearly always.
 *
 * Concretely, `foldAction=F` resolves to `cp.action.folding-estimate`, where
 * `simulator.toggleFaces` masks `cp.action.line-type.auxiliary` — which still
 * holds F under the shipped defaults and comes first in the registry. Trusting
 * `conditional` alone applied the row and labelled the result "shares the key
 * with the simulator", when in fact Fold never fired.
 */
const CONDITIONAL_CLAIMANTS_SILENCED: ShortcutOverrides = Object.fromEntries(
  SHORTCUT_DEFINITIONS.filter(
    (definition) => definition.scope === 'simulator' || shortcutMayDecline(definition.id)
  ).map((definition) => [definition.id, []])
);

/**
 * The shadowing that survives with every may-not-answer claimant out of the
 * stack, i.e. the one that is real regardless of what the simulator is doing or
 * what the viewport happens to have selected. Null means the chord is genuinely
 * only shared with one of those.
 */
function shadowingWithoutConditionalClaimants(
  id: ShortcutActionId,
  chord: KeyChord,
  resolution: PlanResolution
): ShortcutShadowing | null {
  // Silencing the binding being asked about would ask a meaningless question.
  const definition = getShortcutDefinition(id);
  if (definition?.scope === 'simulator' || shortcutMayDecline(id)) return null;
  return findShortcutShadowing(id, chord, {
    ...resolution,
    overrides: { ...resolution.overrides, ...CONDITIONAL_CLAIMANTS_SILENCED },
  });
}

/**
 * Drop every candidate that would end up sharing a chord, repeating until the
 * survivors are stable.
 *
 * One pass is not enough, and the reason is easy to miss: dropping a candidate
 * *restores* its target's default chord, which can collide with a candidate that
 * passed. Import Mountain→Mod+S (shadowed by Save, so dropped) and Valley→A, and
 * after that drop Mountain is back on A — leaving Valley bound to a key it can
 * never win. Iterating to a fixed point is what makes "an applied plan contains
 * no shadowed binding" true rather than usually true. It terminates because the
 * candidate set only ever shrinks.
 *
 * Each pass validates against the *fully built* candidate set, never
 * incrementally: `getResolvedShortcuts` falls back to defaults for any id not yet
 * in the overrides, so a half-built set reports phantom conflicts for something
 * as ordinary as swapping two keys.
 */
function resolveShadowing(
  candidates: Map<ShortcutActionId, KeyChord>,
  current: PlanResolution,
  allowEvictionFor: ReadonlySet<ShortcutActionId>
): ShadowResolution {
  const rejected = new Map<ShortcutActionId, OrieditaImportShadowing>();
  const evicted = new Map<ShortcutActionId, OrieditaImportEviction>();
  /**
   * The one blocker each approved row has already spent its consent on.
   *
   * Approval is per *row*, but the offer the user saw named a single binding, so
   * the row may remove that one and no more. Without this cap a chord with two
   * claimants took both — `Mod+B` is held by Rabbit Ear in crease-pattern and
   * Build Crease Pattern in global, and one click removed the pair while the
   * button named only Rabbit Ear. If the row still cannot apply afterwards it is
   * reported as shadowed, which is the honest answer.
   */
  const spentOn = new Map<ShortcutActionId, ShortcutActionId>();
  // The chord each dropped candidate wanted, so the offer can be derived from
  // the settled result rather than guessed at mid-loop.
  const rejectedChord = new Map<ShortcutActionId, KeyChord>();

  for (;;) {
    const overrides: ShortcutOverrides = { ...current.overrides };
    // Evictions first, so a candidate can claim the chord they release.
    for (const id of evicted.keys()) overrides[id] = null;
    for (const [id, chord] of candidates) overrides[id] = [chord];
    const resolution: PlanResolution = { ...current, overrides };

    const dropped = new Map<ShortcutActionId, OrieditaImportShadowing>();
    const newlyEvicted = new Map<ShortcutActionId, OrieditaImportEviction>();
    // Rebuilt every pass rather than accumulated, so a note can never outlive the
    // collision that produced it: a drop elsewhere changes which chords are
    // claimed, and only the pass that settles is describing the plan we return.
    const deferred = new Map<ShortcutActionId, OrieditaImportShadowing>();
    for (const [id, chord] of candidates) {
      const shadowing = findShortcutShadowing(id, chord, resolution);
      if (!shadowing) continue;
      // A loss to the `simulator` scope alone defers the chord, it does not kill
      // it — that scope enters the stack only while a simulation owns the
      // keyboard, and the shipped defaults already tolerate exactly that on C
      // and L. Keep the binding and let the preview say the key does double
      // duty. But `conditional` describes the *top* claimant only, so ask again
      // with the simulator silenced before believing it: on F and R the
      // simulator was sitting on top of a crease-pattern binding that takes the
      // chord whenever no simulation is focused.
      if (shadowing.kind === 'conditional') {
        const beneath = shadowingWithoutConditionalClaimants(id, chord, resolution);
        if (!beneath) {
          deferred.set(id, shadowingRecord(shadowing));
          continue;
        }
        blockedBy(beneath, id, chord);
        continue;
      }
      blockedBy(shadowing, id, chord);
    }

    /**
     * A hard block is either something this row is allowed to unbind, or a drop.
     * Evicting keeps the candidate alive for the next pass, which is what lets
     * the chain unwind: freeing `R` lets Mirror Line reach it, which frees `M`.
     */
    function blockedBy(blocking: ShortcutShadowing, id: ShortcutActionId, chord: KeyChord): void {
      const blockerId = blocking.definition.id;
      // Who would win is irrelevant to whether eviction helps. If the blocker
      // wins, the imported chord is dead; if the *import* wins, the blocker's
      // chord is dead instead — a shortcut the user still has, silently doing
      // nothing. Either way exactly one binding must end up owning the chord,
      // and the fix is the same: unbind the other one, with consent.
      if (!canEvict(blockerId, id, candidates, evicted)) {
        dropped.set(id, shadowingRecord(blocking));
        return;
      }
      if (allowEvictionFor.has(id) && !spentOn.has(id)) {
        spentOn.set(id, blockerId);
        newlyEvicted.set(blockerId, evictionRecord(blocking, chord, id));
        return;
      }
      // Not approved for this row: drop as before. The offer is derived
      // afterwards from what actually stayed dropped, so it can never advertise
      // resolving a collision that a later pass dissolved on its own.
      dropped.set(id, shadowingRecord(blocking));
      rejectedChord.set(id, chord);
    }

    if (dropped.size === 0 && newlyEvicted.size === 0) {
      return {
        rejected,
        deferred,
        evicted,
        offers: offersFor(rejected, rejectedChord, evicted, current),
      };
    }

    for (const [blockerId, record] of newlyEvicted) evicted.set(blockerId, record);
    for (const [id, shadowing] of dropped) {
      candidates.delete(id);
      rejected.set(id, shadowing);
      // Freeing a chord is only ever worth doing for the row that wanted it. If
      // that row then loses to a blocker nothing may unbind — approve Mountain
      // onto a chord a hand-placed binding holds *above* Undo, and the second
      // blocker is Undo — the removal buys nothing, so it must not survive into
      // the plan: it would take away a binding the user has and hand the chord
      // to no one.
      for (const [blockerId, record] of evicted) {
        if (record.takenById === id) evicted.delete(blockerId);
      }
    }
  }
}

interface ShadowResolution {
  /** Hard losers: dropped from the plan and reported as skipped. */
  readonly rejected: Map<ShortcutActionId, OrieditaImportShadowing>;
  /** Conditional losers: applied, but the preview should note the double duty. */
  readonly deferred: Map<ShortcutActionId, OrieditaImportShadowing>;
  /** Bindings actually removed to make room, for the rows that approved it. */
  readonly evicted: Map<ShortcutActionId, OrieditaImportEviction>;
  /**
   * What "Use anyway" would cost, keyed by the *rejected row's* target — which
   * is what `allowEvictionFor` names, so the dialog can hand back exactly the
   * key it was given.
   */
  readonly offers: Map<ShortcutActionId, OrieditaImportEviction>;
}

/**
 * Whether a blocker may be unbound to let an imported chord through.
 *
 * Three exclusions, each load-bearing:
 * - a blocker the import is *also* rebinding is already moving on its own, so
 *   evicting it would throw away a binding the user asked for;
 * - `shortcutKeepsDefaultChords` (Undo/Redo) merge overrides with defaults
 *   rather than replacing, so a `null` there is not honoured and the preview
 *   would promise a removal that never happens;
 * - evicting the same id twice would loop.
 */
function canEvict(
  blockerId: ShortcutActionId,
  takenById: ShortcutActionId,
  candidates: ReadonlyMap<ShortcutActionId, KeyChord>,
  evicted: ReadonlyMap<ShortcutActionId, OrieditaImportEviction>
): boolean {
  return (
    !candidates.has(blockerId) &&
    !shortcutKeepsDefaultChords(blockerId) &&
    !evicted.has(blockerId) &&
    !isSharedByDesign(blockerId, takenById)
  );
}

/**
 * Blockers that must never be unbound, because the collision is not real.
 *
 * Two kinds, both of which `findShortcutShadowing` reports as conflicts because
 * it compares chords and cannot see intent:
 *
 * - **A `viewport` binding.** Viewport executors *decline* a chord they do not
 *   own and let it fall through — that is the documented mechanism behind
 *   `viewport.delete` sharing Delete with `edit.delete`. Both work today;
 *   unbinding the viewport half would break deleting a selected canvas object to
 *   "fix" a conflict that never fires.
 * - **The same verb twice.** `cp.deleteExtraVertices` and
 *   `cp.action.delete-extra-vertices` both carry `v_del_allAction` and run the
 *   same sweep, so removing either changes nothing except the user's confidence
 *   in the confirmation they were shown.
 */
function isSharedByDesign(blockerId: ShortcutActionId, takenById: ShortcutActionId): boolean {
  const blocker = getShortcutDefinition(blockerId);
  if (!blocker) return false;
  if (blocker.scope === 'viewport') return true;
  const taker = getShortcutDefinition(takenById);
  return Boolean(
    blocker.upstreamAction && taker?.upstreamAction === blocker.upstreamAction
  );
}

/**
 * One offer per skipped row whose blocker could be unbound, derived from the
 * settled plan so a row only advertises a removal that would change *its own*
 * outcome — no more, and nothing already stale.
 */
function offersFor(
  rejected: ReadonlyMap<ShortcutActionId, OrieditaImportShadowing>,
  rejectedChord: ReadonlyMap<ShortcutActionId, KeyChord>,
  evicted: ReadonlyMap<ShortcutActionId, OrieditaImportEviction>,
  current: PlanResolution
): Map<ShortcutActionId, OrieditaImportEviction> {
  const offers = new Map<ShortcutActionId, OrieditaImportEviction>();
  for (const [id, shadowing] of rejected) {
    const chord = rejectedChord.get(id);
    if (!chord) continue;
    const blockerId = shadowing.actionId;
    if (shortcutKeepsDefaultChords(blockerId) || evicted.has(blockerId)) continue;
    if (isSharedByDesign(blockerId, id)) continue;
    const definition = getShortcutDefinition(blockerId);
    if (!definition) continue;
    // Only offer a removal that actually rescues the row.
    //
    // One approval spends itself on the one binding it named, so if a second
    // always-present claimant sits behind the first, taking the offer removes
    // nothing (the drop rolls it back) and the row stays skipped. Advertising
    // that is worse than staying quiet: the button reads as a way through and
    // is not one. `Mod+B` is the real case — Rabbit Ear in front, Build Crease
    // Pattern behind it.
    // Ask the resolver's own question, so the offer cannot promise an outcome
    // the resolver will refuse. Any remaining always-present claimant blocks the
    // row whichever way the contest goes — a binding that loses its chord is as
    // dead as one that never got it — while a simulator claimant is fine, since
    // those coexist by design. That is exactly `shadowingWithoutConditionalClaimants`.
    //
    // Without this, `Mod+B` advertised removing Rabbit Ear while Build Crease
    // Pattern sat behind it: one approval spends itself on one binding, so the
    // row stayed skipped and the button was a way through that led nowhere.
    const withBlockerGone: PlanResolution = {
      overrides: { ...current.overrides, [blockerId]: null, [id]: [chord] },
      defaultsSource: current.defaultsSource,
    };
    if (shadowingWithoutConditionalClaimants(id, chord, withBlockerGone)) continue;
    offers.set(id, {
      evictedId: blockerId,
      evictedLabel: definition.label,
      chord,
      takenById: id,
      takenByLabel: getShortcutDefinition(id)?.label ?? id,
    });
  }
  return offers;
}

function evictionRecord(
  blocking: ShortcutShadowing,
  chord: KeyChord,
  takenById: ShortcutActionId
): OrieditaImportEviction {
  return {
    evictedId: blocking.definition.id,
    evictedLabel: blocking.definition.label,
    chord,
    takenById,
    takenByLabel: getShortcutDefinition(takenById)?.label ?? takenById,
  };
}

/**
 * Build the reviewable plan for one archive.
 *
 * Every rule the rows encode is a correctness requirement rather than a policy
 * choice; each is argued where it is applied. The shape of the pass matters
 * though: rows are decided individually first, then the surviving candidates are
 * validated *as a set*, because whether a binding is reachable is a property of
 * the whole keymap and not of any one row.
 */
export function buildOrieditaImportPlan(input: OrieditaImportPlanInput): OrieditaImportPlan {
  const current: PlanResolution = {
    overrides: input.currentOverrides ?? {},
    defaultsSource: input.defaultsSource,
  };
  const drafts = collectKeyStrokes(input.hotkeys).map((entry) => draftRow(entry, current));

  const candidates = new Map<ShortcutActionId, KeyChord>();
  for (const draft of drafts) {
    if (draft.kind !== 'candidate') continue;
    // `shortcutIdForOrieditaAction` is injective over the registry, so a second
    // claim on one target would mean the action table has grown a collision.
    // First row wins; the loser reads as shadowed by its own twin below.
    if (!candidates.has(draft.shortcutId)) candidates.set(draft.shortcutId, draft.chord);
  }

  const { rejected, deferred, evicted, offers } = resolveShadowing(
    candidates,
    current,
    input.allowEvictionFor ?? new Set()
  );
  const overrides: ShortcutOverrides = {};
  const rows: OrieditaImportRow[] = [];

  for (const draft of drafts) {
    if (draft.kind === 'settled') {
      rows.push(draft.row);
      continue;
    }
    const shadowing = rejected.get(draft.shortcutId);
    const survives = !shadowing && candidates.get(draft.shortcutId) === draft.chord;
    if (!survives) {
      const offer = offers.get(draft.shortcutId);
      rows.push({
        ...draft.base,
        outcome: { kind: 'skip', reason: 'shadowed' },
        detail: {
          replacedChords: [],
          ...(shadowing ? { shadowing } : {}),
          ...(offer ? { evictionOffer: offer } : {}),
        },
      });
      continue;
    }
    const sharedWith = deferred.get(draft.shortcutId);
    const existingChords = getResolvedShortcuts(draft.shortcutId, current);
    const alreadyMatches =
      existingChords.length === 1 && keyChordEquals(existingChords[0], draft.chord);
    // Write only what actually differs. A no-op row still appears in the preview,
    // so the user can see the key was accounted for, but writing it would turn
    // "follows the Ori Studio default" into "explicitly overridden" — and that is
    // visible: `hasOverride` in SettingsModal drives whether a row's Reset button
    // is enabled, so pinning would make most of the Shortcuts list read as
    // customized on a clean profile, for keys the user never touched. It also
    // makes re-importing the same archive a true no-op.
    if (!alreadyMatches) overrides[draft.shortcutId] = [draft.chord];
    rows.push({
      ...draft.base,
      outcome: { kind: 'apply', chord: draft.chord },
      detail: {
        replacedChords: existingChords.filter(
          (existing) => !keyChordEquals(existing, draft.chord)
        ),
        ...(alreadyMatches ? { alreadyMatches } : {}),
        // Applied, but the chord does double duty while a simulation is focused.
        ...(sharedWith ? { shadowing: sharedWith } : {}),
      },
    });
  }

  // An eviction is an explicit `null` override: the binding is unbound, not
  // merely left at its default, so the dispatcher stops handing it the chord.
  for (const evictedId of evicted.keys()) overrides[evictedId] = null;

  return {
    rows,
    overrides,
    evictions: [...evicted.values()],
  };
}
