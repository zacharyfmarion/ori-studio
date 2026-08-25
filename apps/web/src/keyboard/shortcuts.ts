import type { MenuActionId } from '../commands/menuActions';
import { cpVariantHostAction } from '../lib/cpToolVariants';
import {
  cpActionById,
  ORISTUDIO_CP_ACTIONS,
  type OristudioCpActionId,
} from '../lib/oristudioCpActions';
import { ORIEDITA_DEFAULT_HOTKEYS } from '../lib/orieditaImport/orieditaDefaultHotkeys.generated';
import { parseOrieditaKeyStrokeStrict } from '../lib/orieditaImport/parseKeyStroke';
import { isApplePlatform } from '../lib/platform';

/**
 * Scopes are searched front-to-back, so a more specific one wins a chord it
 * shares with a broader one. `simulator` sits ahead of `crease-pattern` and is
 * pushed only while a simulation owns the keyboard — a focused inline window on
 * the Edit canvas, or the Simulate workspace. Without it, the simulator's bare
 * letters (F, C, R, L) and Space would fight the CP tools bound to the same
 * keys, and Space is already space-to-pan on the Edit canvas.
 */
export type ShortcutScope = 'global' | 'crease-pattern' | 'viewport' | 'simulator';
export type ViewportShortcutId =
  | 'viewport.zoomIn'
  | 'viewport.zoomOut'
  | 'viewport.fit'
  | 'viewport.actualSize'
  | 'viewport.pan'
  | 'viewport.rotateCcw'
  | 'viewport.rotateCw'
  | 'viewport.resetRotation'
  | 'viewport.cancel'
  | 'viewport.delete'
  | 'viewport.simulateSelectionInline'
  | 'viewport.solveAnglesPrevious'
  | 'viewport.solveAnglesNext'
  | 'viewport.solveAnglesApply';
export type SimulatorShortcutId =
  | 'simulator.playPause'
  | 'simulator.foldForward'
  | 'simulator.foldBackward'
  | 'simulator.foldEnd'
  | 'simulator.foldStart'
  | 'simulator.replay'
  | 'simulator.resetView'
  | 'simulator.zoomIn'
  | 'simulator.zoomOut'
  | 'simulator.toggleFaces'
  | 'simulator.toggleCreases'
  | 'simulator.toggleHiddenLines'
  | 'simulator.toggleLighting';
export type ShortcutActionId =
  | MenuActionId
  | OristudioCpActionId
  | ViewportShortcutId
  | SimulatorShortcutId;
export type ShortcutTarget = 'menu' | 'cp-action' | 'viewport' | 'simulator';
export type ReservedKeyClassification = 'allowed' | 'soft-reserved' | 'hard-reserved';

export interface KeyChord {
  key: string;
  primary?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  category: string;
  scope: ShortcutScope;
  target: ShortcutTarget;
  defaultChord: KeyChord | null;
  defaultChords: KeyChord[];
  upstreamAction?: string;
}

export type ShortcutOverrides = Partial<Record<ShortcutActionId, KeyChord[] | null>>;

/**
 * Which keyboard layout `defaultChords` resolves against. A standing preference,
 * not a per-lookup detail: `oriedita` puts M/V/L on the line types, F on fold and
 * R on mirror, the way upstream ships them.
 */
export type ShortcutDefaultsSource = 'ori-studio' | 'oriedita';

/** Everything a lookup needs: the active layout, and what the user changed on it. */
export interface ShortcutResolution {
  overrides?: ShortcutOverrides;
  /** Defaults to `'ori-studio'`. */
  defaultsSource?: ShortcutDefaultsSource;
}

/**
 * A bare overrides map is still accepted, because the render sites that only
 * ever had overrides read worse wrapped in `{ overrides }`. The two shapes never
 * collide: neither key is a {@link ShortcutActionId}.
 */
export type ShortcutResolutionInput = ShortcutOverrides | ShortcutResolution;

function resolutionOf(input: ShortcutResolutionInput): ShortcutResolution {
  if ('overrides' in input) return input;
  if ('defaultsSource' in input) return input;
  // `ShortcutActionId` includes a `cp.action.${string}` pattern, so TypeScript
  // cannot rule the resolution shape out of the remaining branch on its own.
  return { overrides: input as ShortcutOverrides };
}

const ALWAYS_AVAILABLE_DEFAULT_SHORTCUTS = new Set<ShortcutActionId>([
  'edit.undo',
  'edit.redo',
]);

export interface ShortcutRegistryDiagnostics {
  unmappedOrieditaActions: string[];
  duplicateDefaultChords: Array<{ scope: ShortcutScope; chord: string; actionIds: ShortcutActionId[] }>;
  reservedDefaultChords: Array<{
    actionId: ShortcutActionId;
    chord: string;
    classification: Exclude<ReservedKeyClassification, 'allowed'>;
  }>;
}

/**
 * Default keystrokes keyed by Oriedita `upstreamAction`.
 *
 * Only crease-pattern tool actions are *driven* by this table (see
 * {@link defaultChordForCpAction}); the menu/global entries below are kept as
 * upstream reference, since those chords are declared in {@link MENU_SHORTCUTS}.
 *
 * The single-key layout follows Robert Brandon Wong's Oriedita-optimized
 * scheme: the left hand rests on the home row and drives the frequent tool and
 * line-type switches while the right hand stays on the mouse. Departures from
 * upstream Oriedita are marked "Ori Studio deviation".
 */
const ORIEDITA_DEFAULTS: Record<string, string> = {
  // -- Tool / mode (left hand, upper row) --------------------------------
  selectAction: 'Q',
  moveAction: 'W',
  copyAction: '2',

  // -- Line types (left-hand home row) -----------------------------------
  colRedAction: 'A', // Mountain
  colBlueAction: 'S', // Valley
  colBlackAction: 'D', // Edge
  colCyanAction: 'F', // Auxiliary
  // Ori Studio addition: no Oriedita equivalent, because Oriedita creases are
  // always a full +/-180. Shift+F sits in the same left-hand family as the line
  // types it complements and leaves A/S/D/F untouched. (Shift+A was the first
  // choice but belongs to a1Action, the three-point angle readout.)
  OriStudioSetFoldAngle: 'shift F',

  // -- Draw / construct --------------------------------------------------
  drawCreaseFreeAction: 'Z', // free line
  // Ori Studio addition: upstream Oriedita has no Space handler at all, but the
  // grid-restricted line is frequent enough to deserve the biggest key, and it
  // pairs with Z for the free line.
  drawCreaseRestrictedAction: 'SPACE',
  perpendicularDrawAction: 'Y',
  angleBisectorAction: 'B',
  // Upstream's own binding, kept exactly. Ori Studio merges the two lengthen
  // tools into one rail tool whose colour mode is a tool param, and a chord
  // bound to a variant by name arms the merged tool *in that variant's mode* --
  // so E still means "extend, keeping each crease's colour", and the rail lights
  // up on Extend Line while it does.
  lengthenCrease2Action: 'E',
  makeFlatFoldableAction: 'T', // flat-foldable line (the rail-visible tool)
  deg2Action: 'R', // radial / angle-restricted snapping (22.5, 30, 15 deg)
  fishBoneDrawAction: 'H', // Oriedita labels this button "gridFill"
  rabbitEarAction: 'ctrl B',
  // Upstream's chord, restored when Reflect Through Lines returned to the rail.
  // `primary+r` is soft-reserved — browsers reload on it — so on the web build
  // this is a chord the user may well have to move. It is upstream's, the rail
  // button reaches the tool without it, and the alternative is inventing a
  // different default for an action Oriedita users already have muscle memory
  // for; `classifyReservedKey` is what warns them if they capture it by hand.
  continuousSymmetricDrawAction: 'ctrl R',
  doubleSymmetricDrawAction: 'ctrl G',
  reflectAction: 'ctrl M',
  // Brandon's layout claims R for radial snapping, so Mirror Line takes M —
  // mnemonic, and freed when the line types moved onto the home row.
  symmetricDrawAction: 'M',

  // -- Measure -----------------------------------------------------------
  // Ori Studio addition: upstream ships no hotkey for these (hotkey.properties is
  // empty for both). `l1Action` / `a1Action` are the two visible measure tools'
  // upstream identities — the other three measure operations are hidden from the
  // UI. Length takes Shift+M so the mirror family keeps the bare key (M mirror
  // line, Ctrl+M reflect), and angle takes the matching Shift+A. These are the
  // app's first bare Shift+letter chords; the dispatcher records `shift` on every
  // event, so M and Shift+M (and A and Shift+A) stay distinct.
  l1Action: 'shift M',
  a1Action: 'shift A',

  // -- Mountain / valley -------------------------------------------------
  senbun_henkan2Action: 'C', // flip M/V of the selection
  in_L_col_changeAction: 'X', // alternate M/V along a line (ridges)

  // -- Fold --------------------------------------------------------------
  foldAction: 'G',

  // -- Upstream reference (chords declared in MENU_SHORTCUTS) -------------
  selectAllAction: 'ctrl A',
  deleteSelectedLineSegmentAction: 'DELETE',
  v_del_allAction: 'ctrl shift V',
  // Unmapped: no CP action carries this upstream yet, so it yields no chord.
  // Binding it would need a key other than G, which fold now owns.
  gridConfigureAction: 'G',
  undoAction: 'ctrl Z',
  redoAction: 'ctrl shift Z',
  foldedFigureFlipAction: 'ctrl alt F',
  haltAction: 'ESCAPE',
  foldedFigureTrashAction: 'ctrl F',
  newAction: 'ctrl N',
  openAction: 'ctrl O',
  saveAction: 'ctrl S',
  saveAsAction: 'ctrl alt S',
  prefAction: 'ctrl shift P',
  exitAction: 'ctrl Q',
  copyClipboardAction: 'ctrl C',
  cutClipboardAction: 'ctrl X',
  pasteClipboardAction: 'ctrl V',
  pasteOffsetClipboardAction: 'ctrl shift V',
};

const MENU_SHORTCUTS: ShortcutDefinition[] = [
  menuShortcut('file.new', 'New', 'File', { primary: true, key: 'n' }, 'newAction'),
  menuShortcut('file.open', 'Open...', 'File', { primary: true, key: 'o' }, 'openAction'),
  menuShortcut('file.save', 'Save', 'File', { primary: true, key: 's' }, 'saveAction'),
  menuShortcut(
    'file.saveAs',
    'Save As...',
    'File',
    { primary: true, shift: true, key: 's' },
    'saveAsAction'
  ),
  menuShortcut('file.settings', 'Settings', 'File', { primary: true, key: ',' }, 'prefAction'),
  menuShortcut('edit.undo', 'Undo', 'Edit', { primary: true, key: 'z' }, 'undoAction'),
  menuShortcut('edit.redo', 'Redo', 'Edit', { primary: true, shift: true, key: 'z' }, 'redoAction'),
  menuShortcut('edit.cut', 'Cut', 'Edit', { primary: true, key: 'x' }, 'cutClipboardAction'),
  menuShortcut('edit.copy', 'Copy', 'Edit', { primary: true, key: 'c' }, 'copyClipboardAction'),
  menuShortcut('edit.paste', 'Paste', 'Edit', { primary: true, key: 'v' }, 'pasteClipboardAction'),
  menuShortcut(
    'edit.delete',
    'Delete Selected',
    'Edit',
    [{ key: 'delete' }, { key: 'backspace' }],
    'deleteSelectedLineSegmentAction'
  ),
  menuShortcut('edit.selectAll', 'Select All', 'Edit', { primary: true, key: 'a' }, 'selectAllAction'),
  menuShortcut('optimize.scale', 'Optimize Scale', 'Design', { primary: true, key: 'r' }),
  menuShortcut('cp.build', 'Build Crease Pattern', 'Design', { primary: true, key: 'b' }),
  // The other half of `cp.action.crease-make-unassigned`, which keeps the
  // direction. Bound through the menu id rather than as a CP action because the
  // two verbs are one kernel operation and a payload flag, and
  // `buildCpShortcutDefinitions` is one-per-operation.
  menuShortcut('cp.makeUnassigned', 'Make Unassigned', 'Crease Pattern', null),
  menuShortcut('cp.checkCamv', 'Check foldability', 'Crease Pattern', {
    primary: true,
    shift: true,
    key: 'm',
  }),
  // Upstream binds this chord twice — `v_del_allAction` and
  // `pasteOffsetClipboardAction` both claim `ctrl shift V` in
  // hotkey.properties. Neither is bound here yet, so the sweep takes it; if
  // paste-offset is ever wired it needs a different chord, because duplicate
  // chords fail silently in the dispatcher.
  menuShortcut(
    'cp.deleteExtraVertices',
    'Delete Extra Vertices',
    'Crease Pattern',
    { primary: true, shift: true, key: 'v' },
    'v_del_allAction'
  ),
];

function simulatorShortcut(
  id: SimulatorShortcutId,
  label: string,
  defaultChord: KeyChord | KeyChord[]
): ShortcutDefinition {
  const defaultChords = normalizeDefaultChords(defaultChord);
  return {
    id,
    label,
    category: 'Simulator',
    scope: 'simulator',
    target: 'simulator',
    defaultChord: defaultChords[0] ?? null,
    defaultChords,
  };
}

/**
 * Simulator bindings. These used to be a bare `window` keydown listener inside
 * the Simulate panel, justified by the panel only ever mounting in its own
 * workspace — which stopped being true when inline simulation windows arrived on
 * the Edit canvas. Going through the registry also means they finally honour the
 * user's shortcut overrides, which the ad-hoc listener bypassed entirely.
 */
const SIMULATOR_SHORTCUTS: ShortcutDefinition[] = [
  simulatorShortcut('simulator.playPause', 'Play / Pause Fold', { key: ' ' }),
  simulatorShortcut('simulator.foldForward', 'Fold Forward', { key: 'arrowright' }),
  simulatorShortcut('simulator.foldBackward', 'Fold Backward', { key: 'arrowleft' }),
  simulatorShortcut('simulator.foldEnd', 'Jump To Folded', { shift: true, key: 'arrowright' }),
  simulatorShortcut('simulator.foldStart', 'Jump To Flat', { shift: true, key: 'arrowleft' }),
  simulatorShortcut('simulator.replay', 'Replay From Flat', { key: 'r' }),
  simulatorShortcut('simulator.resetView', 'Reset Simulator View', [
    { key: '0' },
    { key: 'home' },
  ]),
  simulatorShortcut('simulator.zoomIn', 'Zoom In Simulator', [{ key: '=' }, { key: '+' }]),
  simulatorShortcut('simulator.zoomOut', 'Zoom Out Simulator', [{ key: '-' }, { key: '_' }]),
  simulatorShortcut('simulator.toggleFaces', 'Toggle Faces', { key: 'f' }),
  simulatorShortcut('simulator.toggleCreases', 'Toggle Crease Lines', { key: 'c' }),
  simulatorShortcut('simulator.toggleHiddenLines', 'Toggle Hidden Lines', { key: 'h' }),
  simulatorShortcut('simulator.toggleLighting', 'Toggle Lighting', { key: 'l' }),
];

/**
 * The viewport verbs whose executor can answer `false` and let the chord fall
 * through to the next scope.
 *
 * This is the property the conflict rules actually care about, and for a long
 * time they asked `scope === 'viewport'` instead. Those are not the same
 * question: `viewport.zoomOut` claims its chord every single time, so a
 * crease-pattern tool bound to the same key is dead — but it was exempted from
 * eviction anyway, on the reasoning that only holds for the four below. That
 * made eleven chords (`Mod+=` `6` `Mod+-` `5` `Mod+0` `Mod+1` `1` `3` `4`
 * `Escape` `Shift+S`) permanently unassignable in both Settings and the Oriedita
 * import.
 *
 * Membership is read off the *crease-pattern* executor's switch, because that is
 * the surface live in the same context as the bindings these collide with. It
 * cannot be read off every surface at once: `tree` and `bp-editor` implement
 * only the four camera verbs and decline the rest outright, so "declines
 * somewhere" would sweep in nearly everything.
 *
 * Declared here while the truth lives in `CreasePatternPanel`'s switch, so the
 * two can drift. The set is typed to `ViewportShortcutId`, which stops a
 * non-viewport id being added at all — the dispatcher ignores every other
 * target's return value, so the claim would be a lie anywhere else.
 */
const DECLINING_VIEWPORT_SHORTCUTS: ReadonlySet<ViewportShortcutId> = new Set([
  'viewport.delete',
  'viewport.solveAnglesPrevious',
  'viewport.solveAnglesNext',
  'viewport.solveAnglesApply',
]);

/**
 * Whether this binding may hand its chord back instead of claiming it.
 *
 * A claimant that may decline does not make a lower-scope binding dead, so it is
 * not a blocker — it is *transparent*, and whatever claims the chord beneath it
 * is the thing a conflict warning should name.
 */
export function shortcutMayDecline(id: ShortcutActionId): boolean {
  return (DECLINING_VIEWPORT_SHORTCUTS as ReadonlySet<string>).has(id);
}

const VIEWPORT_SHORTCUTS: ShortcutDefinition[] = [
  // Ori Studio's own defaults, not Oriedita's: upstream ships both zoom actions
  // unbound (`hotkey.properties` has empty `creasePatternZoomOutAction=` /
  // `creasePatternZoomInAction=`, and no Java source hardcodes a digit handler).
  // The bare 6/5 chords let the left hand zoom without reaching for a modifier.
  viewportShortcut(
    'viewport.zoomIn',
    'Zoom In',
    [{ primary: true, key: '=' }, { key: '6' }],
    'creasePatternZoomInAction'
  ),
  viewportShortcut(
    'viewport.zoomOut',
    'Zoom Out',
    [{ primary: true, key: '-' }, { key: '5' }],
    'creasePatternZoomOutAction'
  ),
  viewportShortcut('viewport.fit', 'Fit To View', { primary: true, key: '0' }),
  viewportShortcut('viewport.actualSize', 'Actual Size', { primary: true, key: '1' }),
  viewportShortcut('viewport.pan', 'Pan (hand tool)', { key: '1' }),
  // Upstream turns the camera by `angleSystemModel.getAngleStep()` per press
  // rather than our fixed step, so the two agree on the verb and not on the
  // amount. The chord is what an import carries, and the verb is what it names.
  viewportShortcut('viewport.rotateCcw', 'Rotate View Left', { key: '3' }, 'rotateAnticlockwiseAction'),
  viewportShortcut('viewport.rotateCw', 'Rotate View Right', { key: '4' }, 'rotateClockwiseAction'),
  viewportShortcut('viewport.resetRotation', 'Reset View Rotation', null),
  // Escape is a viewport shortcut like any other, so it dispatches
  // focus-independently. A viewport that scopes it to its own container instead
  // loses it to whatever floating editor, toolbar, or portalled menu took focus
  // last — see AGENTS.md > "Panel components".
  //
  // Deliberately carries no `upstreamAction`. Oriedita's Escape is `haltAction`,
  // which stops the CAMV and folding task executors and nothing else
  // (`HaltAction.java`); this cancels in-progress canvas input and clears the
  // selection. Claiming the pair would let an Oriedita user who moved "stop the
  // running fold" silently move "cancel what I am drawing" instead.
  viewportShortcut('viewport.cancel', 'Cancel / Deselect', { key: 'escape' }),
  // Delete is shared with `edit.delete` at global scope, which deletes creases.
  // Viewport scope resolves first, so this one is asked whether the *viewport*
  // owns the press — a selected canvas object, or a measurement to drop — and
  // declines when it does not, letting the chord fall through. That decline is
  // what makes one binding safe here; both of these verbs used to be raw
  // `keydown` listeners on the panel precisely because it did not exist, and
  // both then fired *alongside* crease deletion rather than instead of it.
  //
  // One definition rather than one per verb: the dispatcher takes the first
  // match in a scope, so a second Delete binding here would be unreachable. The
  // ladder lives in the executor, as it already does for `viewport.cancel`.
  // Stepping through the fold-angle solutions for a vertex, and applying one.
  // Scoped to the viewport and *declined* whenever that tool is not holding a
  // set of answers, so the arrows and Enter fall through to whatever else wants
  // them — the same decline `viewport.delete` relies on. A container `keydown`
  // listener would instead go dead the moment the context panel's own buttons
  // took focus, which is exactly where the user's hands are while stepping.
  viewportShortcut('viewport.solveAnglesPrevious', 'Previous Fold-Angle Solution', {
    key: 'arrowleft',
  }),
  viewportShortcut('viewport.solveAnglesNext', 'Next Fold-Angle Solution', { key: 'arrowright' }),
  viewportShortcut('viewport.solveAnglesApply', 'Apply Fold-Angle Solution', { key: 'enter' }),
  viewportShortcut('viewport.delete', 'Delete Selected Object', [
    { key: 'delete' },
    { key: 'backspace' },
  ]),
  // Shift+<letter> is where the crease-pattern surface's own verbs live —
  // Shift+A and Shift+M are the measure tools. Plain S is free; Mod+Shift+S is
  // Save As, which is a different chord.
  viewportShortcut('viewport.simulateSelectionInline', 'Simulate Selection Inline', {
    shift: true,
    key: 's',
  }),
];

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  ...MENU_SHORTCUTS,
  ...buildCpShortcutDefinitions(),
  ...SIMULATOR_SHORTCUTS,
  ...VIEWPORT_SHORTCUTS,
];

const SHORTCUT_DEFINITION_BY_ID = new Map(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition])
);

/**
 * Where an imported Oriedita binding lands when more than one definition claims
 * the same `upstreamAction`.
 *
 * `upstreamAction` is a label, not a key: the inverse is not a function. Four
 * upstream actions are claimed twice, so an importer that walked the registry
 * would bind whichever happened to come first in `SHORTCUT_DEFINITIONS` — an
 * ordering nobody chose. Naming the winner here makes the choice reviewable, and
 * `shortcuts.test.ts` asserts this table covers *exactly* the duplicate set, so
 * a fifth collision fails CI rather than picking a target by accident.
 *
 * Only duplicates belong here. Anything claimed once resolves through the
 * inverse index below.
 */
export const ORIEDITA_ACTION_TARGETS: Readonly<Record<string, ShortcutActionId>> = {
  // `cp.action.fold` is a hidden not-implemented stub; folding-estimate is the
  // one carrying G and the one `handleCpShortcutAction` routes to the real fold.
  foldAction: 'cp.action.folding-estimate',
  // The direct port of upstream's MOVE_CALCULATED_SHAPE_102 mouse mode.
  // `folded-figure-move-camera` is our own re-expression of it as a camera verb,
  // marked out-of-scope because the grid viewport already owns that.
  foldedFigureMoveAction: 'cp.action.move-calculated-shape',
  // Likewise CHANGE_STANDARD_FACE_103: `change-standard-face` is the mouse mode,
  // `folded-figure-set-starting-face` the folded-figure-model wrapper over it.
  koteimen_siteiAction: 'cp.action.change-standard-face',
  // Global scope, so the chord answers from every context the way Oriedita's
  // single keymap does; the crease-pattern sibling only answers on the CP
  // canvas. Both run the same sweep, and both ship Mod+Shift+V by default.
  v_del_allAction: 'cp.deleteExtraVertices',
};

const SHORTCUT_ID_BY_UNIQUE_UPSTREAM_ACTION = buildUniqueUpstreamActionIndex();

function buildUniqueUpstreamActionIndex(): Map<string, ShortcutActionId> {
  const claims = new Map<string, ShortcutActionId[]>();
  for (const definition of SHORTCUT_DEFINITIONS) {
    if (!definition.upstreamAction) continue;
    claims.set(definition.upstreamAction, [
      ...(claims.get(definition.upstreamAction) ?? []),
      definition.id,
    ]);
  }
  const unique = new Map<string, ShortcutActionId>();
  for (const [upstreamAction, ids] of claims) {
    const [only] = ids;
    if (ids.length === 1 && only) unique.set(upstreamAction, only);
  }
  return unique;
}

/**
 * The action an Oriedita hotkey key names here, or `null` when we have no
 * counterpart — which is the common case, since 198 of upstream's 232 actions
 * ship unbound and many have no Ori Studio equivalent at all.
 *
 * `hasOwnProperty` rather than a bare index because `action` comes from a parsed
 * `hotkey.properties`, where `constructor` is as valid a key as any other.
 */
export function shortcutIdForOrieditaAction(action: string): ShortcutActionId | null {
  if (Object.prototype.hasOwnProperty.call(ORIEDITA_ACTION_TARGETS, action)) {
    return ORIEDITA_ACTION_TARGETS[action] ?? null;
  }
  return SHORTCUT_ID_BY_UNIQUE_UPSTREAM_ACTION.get(action) ?? null;
}

/**
 * Hidden crease-pattern stubs that may still hold a chord: `handleCpShortcutAction`
 * intercepts them and drives the real fold path, so the key lands on something
 * visible after all. The same exemption `shortcutRegistry.test.ts` and
 * `importPlan.ts` grant, for the same reason.
 */
export const ROUTED_CP_SHORTCUT_ACTIONS: ReadonlySet<ShortcutActionId> =
  new Set<ShortcutActionId>(['cp.action.folding-estimate', 'cp.action.fold']);

/**
 * Whether a definition may carry a *default* chord at all.
 *
 * The shipped table is curated, so `shortcutRegistry.test.ts` can enforce this
 * from the outside; the Oriedita layout below is derived from upstream, so the
 * rule has to be applied on the way in. A chord on a not-yet-implemented action
 * does nothing, and a chord on a hidden action arms a tool the rail cannot show
 * as active — unless it is a merged tool's non-host variant, which arms its host.
 */
function acceptsDerivedDefaultChord(definition: ShortcutDefinition): boolean {
  if (definition.target !== 'cp-action' || !isCpActionId(definition.id)) return true;
  if (ROUTED_CP_SHORTCUT_ACTIONS.has(definition.id)) return true;
  const action = cpActionById(definition.id);
  if (!action || action.uiStatus !== 'ready') return false;
  if (action.placement !== 'hidden-ui-only') return true;
  return action.kind === 'command' && cpVariantHostAction(action).id !== action.id;
}

/**
 * Upstream's layout, derived from the vendored `hotkey.properties` snapshot
 * rather than hand-written, so the drift guard on that snapshot protects this
 * too. Entries that name no Ori Studio action, do not parse, or name an action
 * that cannot hold a default are dropped — the predicates the importer already
 * uses, so the two cannot disagree about a key.
 *
 * Ori Studio-only tools (radial snapping, the measure tools, the inline
 * simulator) keep their own default where it does not collide, since upstream
 * has no opinion about them and unbinding forty tools to be "pure" would be
 * worse than the half-migration this exists to fix. Where one *does* collide,
 * Oriedita wins: its keys being where the user expects them is the whole point.
 *
 * Collisions are judged within a scope, matching the duplicate-free invariant
 * `getShortcutRegistryDiagnostics` reports. Across scopes a shared chord is
 * ordinary — `viewport.delete` shares Delete with `edit.delete` by design.
 */
function buildOrieditaDefaultChords(): Map<ShortcutActionId, KeyChord[]> {
  const assigned = new Map<ShortcutActionId, KeyChord[]>();
  const claimed = new Set<string>();

  for (const [orieditaAction, keyStroke] of Object.entries(ORIEDITA_DEFAULT_HOTKEYS)) {
    const id = shortcutIdForOrieditaAction(orieditaAction);
    if (!id || assigned.has(id)) continue;
    const definition = getShortcutDefinition(id);
    if (!definition || !acceptsDerivedDefaultChord(definition)) continue;
    if (!ORIEDITA_LAYOUT_SCOPES.has(definition.scope)) continue;
    const parsed = parseOrieditaKeyStrokeStrict(keyStroke);
    if (!parsed.ok) continue;
    // Upstream binds `ctrl shift V` twice; first claimant in file order wins, so
    // the derived table stays duplicate-free the way the shipped one is.
    const claim = scopedChordId(definition.scope, parsed.chord);
    if (claimed.has(claim)) continue;
    claimed.add(claim);
    assigned.set(id, [parsed.chord]);
  }

  for (const definition of SHORTCUT_DEFINITIONS) {
    if (assigned.has(definition.id)) continue;
    assigned.set(
      definition.id,
      definition.defaultChords.filter(
        (chord) => !claimed.has(scopedChordId(definition.scope, chord))
      )
    );
  }
  return assigned;
}

/**
 * The layout swap covers the drawing surface only.
 *
 * What a user coming from Oriedita has in their hands is M/V/L, F, R — the tools.
 * Their app chrome is the platform's, not Oriedita's, and taking that over does
 * real damage for no muscle-memory gain: upstream's `prefAction` is Ctrl+Shift+P,
 * which would move Settings off the macOS-standard Cmd+comma, and its
 * `deleteSelectedLineSegmentAction` is DELETE alone, which would drop Backspace —
 * the only delete key most Mac laptops have.
 *
 * So `global` (menus), `viewport` (canvas navigation) and `simulator` keep Ori
 * Studio's chords under either source. In practice only `global` differs;
 * upstream ships no binding for the viewport verbs at all.
 */
const ORIEDITA_LAYOUT_SCOPES: ReadonlySet<ShortcutScope> = new Set(['crease-pattern']);

function scopedChordId(scope: ShortcutScope, chord: KeyChord): string {
  return `${scope}:${keyChordId(chord)}`;
}

function isCpActionId(id: ShortcutActionId): id is OristudioCpActionId {
  return id.startsWith('cp.action.');
}

/**
 * Built on first use rather than at module load: `parseKeyStroke` imports back
 * from this module, and calling into it while this module's body is still
 * running would read its tables before they exist.
 */
let orieditaDefaultChords: Map<ShortcutActionId, KeyChord[]> | null = null;

export function getDefaultShortcutChords(
  id: ShortcutActionId,
  defaultsSource: ShortcutDefaultsSource = 'ori-studio'
): KeyChord[] {
  const definition = getShortcutDefinition(id);
  if (!definition) return [];
  if (defaultsSource !== 'oriedita') return definition.defaultChords;
  orieditaDefaultChords ??= buildOrieditaDefaultChords();
  return orieditaDefaultChords.get(id) ?? definition.defaultChords;
}

/**
 * Whether an override may name this action at all.
 *
 * Lives here rather than beside either caller, because the two ways a user
 * assigns a key — the Oriedita import and capturing a chord in Settings — must
 * not disagree about it. They did: the import refused a not-implemented stub
 * while capture happily bound one, destroying a working default to do it.
 *
 * Overrides bypass every invariant `shortcutRegistry.test.ts` enforces on the
 * *default* table, so the rules that table encodes have to be re-applied: a
 * chord on a not-yet-implemented action does nothing, and a chord on an action
 * with no button arms a tool the rail cannot show as active.
 *
 * `edit.undo` / `edit.redo` are unbindable for a different reason —
 * {@link getResolvedShortcuts} *merges* their overrides with the defaults rather
 * than replacing, so an override there can only ever add a second chord. Any UI
 * claiming to move or clear them would be promising something that cannot happen.
 */
export function isShortcutBindable(id: ShortcutActionId): boolean {
  const definition = getShortcutDefinition(id);
  if (!definition) return false;
  if (shortcutKeepsDefaultChords(id)) return false;
  if (ROUTED_CP_SHORTCUT_ACTIONS.has(id)) return true;
  if (definition.target !== 'cp-action' || !isCpActionId(id)) return true;
  const action = cpActionById(id);
  if (!action) return true;
  if (action.uiStatus !== 'ready') return false;
  // A merged tool's non-host variant is hidden only because it has no button of
  // its own; `handleCpToolAction` arms its host, so the rail does light up. That
  // exemption is how `lengthenCrease2Action` keeps E.
  if (action.placement !== 'hidden-ui-only') return true;
  return action.kind === 'command' && cpVariantHostAction(action).id !== action.id;
}

function menuShortcut(
  id: MenuActionId,
  label: string,
  category: string,
  defaultChord: KeyChord | KeyChord[] | null,
  upstreamAction?: string
): ShortcutDefinition {
  const defaultChords = normalizeDefaultChords(defaultChord);
  return {
    id,
    label,
    category,
    scope: 'global',
    target: 'menu',
    defaultChord: defaultChords[0] ?? null,
    defaultChords,
    upstreamAction,
  };
}

function viewportShortcut(
  id: ViewportShortcutId,
  label: string,
  defaultChord: KeyChord | KeyChord[] | null,
  upstreamAction?: string
): ShortcutDefinition {
  const defaultChords = normalizeDefaultChords(defaultChord);
  return {
    id,
    label,
    category: 'Viewport',
    scope: 'viewport',
    target: 'viewport',
    defaultChord: defaultChords[0] ?? null,
    defaultChords,
    upstreamAction,
  };
}

function buildCpShortcutDefinitions(): ShortcutDefinition[] {
  const seen = new Set<string>();
  return ORISTUDIO_CP_ACTIONS.map((action) => {
    const defaultChord = defaultChordForCpAction(action.upstreamAction);
    const duplicate = defaultChord ? keyChordId(defaultChord) : null;
    const safeDefaultChord = duplicate && seen.has(duplicate) ? null : defaultChord;
    const defaultChords = normalizeDefaultChords(safeDefaultChord);
    if (duplicate && safeDefaultChord) seen.add(duplicate);
    return {
      id: action.id,
      label: action.label,
      category: action.group === 'line-type' ? 'Line Type' : cpCategoryLabel(action.group),
      scope: 'crease-pattern',
      target: 'cp-action',
      defaultChord: defaultChords[0] ?? null,
      defaultChords,
      upstreamAction: action.upstreamAction,
    };
  });
}

function normalizeDefaultChords(chords: KeyChord | KeyChord[] | null): KeyChord[] {
  if (!chords) return [];
  const values = Array.isArray(chords) ? chords : [chords];
  return values.map(normalizeKeyChord).filter((chord) => chord.key);
}

function defaultChordForCpAction(upstreamAction: string): KeyChord | null {
  const raw = ORIEDITA_DEFAULTS[upstreamAction];
  return raw ? parseOrieditaKeyStroke(raw, { ctrlAsPrimary: true }) : null;
}

function cpCategoryLabel(group: string): string {
  switch (group) {
    case 'select-edit':
      return 'Select And Edit';
    case 'draw':
      return 'Draw';
    case 'construct':
      return 'Construct';
    case 'transform':
      return 'Transform';
    case 'color':
      return 'Color';
    case 'annotations':
      return 'Annotations';
    case 'generators':
      return 'Generators';
    case 'measure':
      return 'Measure';
    case 'check-fix':
      return 'Check And Fix';
    case 'folding':
      return 'Fold';
    default:
      return 'Crease Pattern';
  }
}

export function getShortcutDefinition(
  id: ShortcutActionId
): ShortcutDefinition | undefined {
  return SHORTCUT_DEFINITION_BY_ID.get(id);
}

export function getShortcutRegistryDiagnostics(): ShortcutRegistryDiagnostics {
  const mappedOrieditaActions = new Set(
    SHORTCUT_DEFINITIONS.map((definition) => definition.upstreamAction).filter(Boolean)
  );
  const duplicateBuckets = new Map<string, ShortcutActionId[]>();
  const reservedDefaultChords: ShortcutRegistryDiagnostics['reservedDefaultChords'] = [];

  for (const definition of SHORTCUT_DEFINITIONS) {
    for (const defaultChord of definition.defaultChords) {
      const duplicateKey = `${definition.scope}:${keyChordId(defaultChord)}`;
      duplicateBuckets.set(duplicateKey, [
        ...(duplicateBuckets.get(duplicateKey) ?? []),
        definition.id,
      ]);
      const classification = classifyReservedKey(defaultChord);
      if (classification !== 'allowed') {
        reservedDefaultChords.push({
          actionId: definition.id,
          chord: formatKeyChord(defaultChord),
          classification,
        });
      }
    }
  }

  return {
    unmappedOrieditaActions: Object.keys(ORIEDITA_DEFAULTS).filter(
      (action) => !mappedOrieditaActions.has(action)
    ),
    duplicateDefaultChords: Array.from(duplicateBuckets.entries())
      .filter((entry) => entry[1].length > 1)
      .map(([key, actionIds]) => {
        const [scope, chord] = key.split(':', 2) as [ShortcutScope, string];
        return { scope, chord, actionIds };
      }),
    reservedDefaultChords,
  };
}

export function getResolvedShortcut(
  id: ShortcutActionId,
  resolution: ShortcutResolutionInput = {}
): KeyChord | null {
  return getResolvedShortcuts(id, resolution)[0] ?? null;
}

export function getResolvedShortcuts(
  id: ShortcutActionId,
  resolution: ShortcutResolutionInput = {}
): KeyChord[] {
  const { overrides = {}, defaultsSource } = resolutionOf(resolution);
  const definition = getShortcutDefinition(id);
  if (!definition) return [];
  const defaultChords = getDefaultShortcutChords(id, defaultsSource);
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    const overrideChords = (overrides[id] ?? [])
      .map(normalizeKeyChord)
      .filter((chord) => chord.key);
    // Merging against the *active* source's defaults, so Undo never picks up a
    // chord from the layout the user is not on.
    return shortcutKeepsDefaultChords(id)
      ? mergeKeyChords(defaultChords, overrideChords)
      : overrideChords;
  }
  return defaultChords;
}

export function shortcutKeepsDefaultChords(id: ShortcutActionId): boolean {
  return ALWAYS_AVAILABLE_DEFAULT_SHORTCUTS.has(id);
}

function mergeKeyChords(defaultChords: KeyChord[], overrideChords: KeyChord[]): KeyChord[] {
  const seen = new Set<string>();
  const merged: KeyChord[] = [];
  for (const chord of [...defaultChords, ...overrideChords]) {
    const key = keyChordId(chord);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(chord);
  }
  return merged;
}

export function shortcutLabelForAction(
  id: ShortcutActionId,
  resolution: ShortcutResolutionInput = {}
): string | undefined {
  const chords = getResolvedShortcuts(id, resolution);
  return chords.length > 0 ? chords.map((chord) => formatKeyChord(chord)).join(' / ') : undefined;
}

export function findShortcutConflict(
  actionId: ShortcutActionId,
  chord: KeyChord,
  resolution: ShortcutResolutionInput = {}
): ShortcutDefinition | null {
  const definition = getShortcutDefinition(actionId);
  if (!definition) return null;

  for (const candidate of SHORTCUT_DEFINITIONS) {
    if (candidate.id === actionId) continue;
    if (!shortcutScopesOverlap(definition.scope, candidate.scope)) continue;
    if (
      getResolvedShortcuts(candidate.id, resolution).some((candidateChord) =>
        keyChordEquals(candidateChord, chord)
      )
    ) {
      return candidate;
    }
  }
  return null;
}

function shortcutScopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a === b) return true;
  if (a === 'global' || b === 'global') return false;
  return a === 'viewport' || b === 'viewport';
}

export interface ShortcutShadowing {
  /** The other definition resolving to the same chord. */
  definition: ShortcutDefinition;
  /**
   * Which of the two the dispatcher actually reaches. Compare against the id you
   * asked about: not equal means that binding is dead while the other is live.
   */
  winnerId: ShortcutActionId;
  /**
   * Whether the loser is dead outright, or merely deferred.
   *
   * Two claimants defer rather than kill. `simulator` is the one scope that is
   * not always in the stack — `shortcutScopeStackForContext` pushes it only while
   * a simulation owns the keyboard. So a simulator binding over a non-simulator
   * one takes the chord *while a simulation is focused* and gives it back
   * otherwise, which is the documented intent at the top of this file rather than
   * a collision. A viewport binding that {@link shortcutMayDecline} is the same
   * story by a different mechanism: always in the stack, but it answers `false`
   * when it does not apply and dispatch continues past it.
   *
   * The shipped defaults already depend on it: `colCyanAction` F, `senbun_henkan2Action`
   * C and `deg2Action` R coexist with `simulator.toggleFaces`/`toggleCreases`/`replay`,
   * and the duplicate-chord test passes because they sit in different scopes.
   * A caller that refuses every shadowed chord — the Oriedita import did — throws
   * away keys over a conflict that does not exist; measured on that import, `C`
   * and `L` are recovered by drawing this distinction. (`F` and `R` are *not*:
   * each has a second crease-pattern claimant underneath the simulator one, which
   * is exactly why `kind` is computed from the highest-precedence *always-present*
   * claimant rather than from the top one.)
   */
  kind: 'hard' | 'conditional';
}

/**
 * Scope precedence exactly as the dispatcher sees it — the order
 * `shortcutScopeStackForContext` builds, with every optional scope present at
 * once, which is the arrangement in which shadowing actually happens.
 */
const SHORTCUT_SCOPE_PRECEDENCE: Record<ShortcutScope, number> = {
  simulator: 0,
  viewport: 1,
  'crease-pattern': 2,
  global: 3,
};

/** True when `a` is the definition `handleShortcutKeyDown` reaches first. */
function shortcutDispatchPrecedes(a: ShortcutDefinition, b: ShortcutDefinition): boolean {
  const scopeDelta = SHORTCUT_SCOPE_PRECEDENCE[a.scope] - SHORTCUT_SCOPE_PRECEDENCE[b.scope];
  if (scopeDelta !== 0) return scopeDelta < 0;
  // Within one scope the dispatcher takes `SHORTCUT_DEFINITIONS.find`'s answer,
  // so registry order decides.
  return SHORTCUT_DEFINITIONS.indexOf(a) < SHORTCUT_DEFINITIONS.indexOf(b);
}

/**
 * Conflict detection for bulk imports, modelling the resolution
 * {@link findShortcutConflict} deliberately does not.
 *
 * `findShortcutConflict` asks `shortcutScopesOverlap`, which answers `false` for
 * global↔crease-pattern. That is right for the manual capture UI — a CP tool
 * chord and a menu chord genuinely coexist most of the time, and warning on
 * every one of them would be noise. It is wrong for an import, because
 * `handleShortcutKeyDown` walks the scope stack and takes the *first* match: a
 * crease-pattern binding on Mod+S does not coexist with Save, it replaces it
 * whenever the CP canvas is the editing context. An Oriedita keymap is
 * single-scope and full of bare letters, so it produces exactly that collision
 * in bulk.
 *
 * Returns the other definition *and* the winner, because the two outcomes need
 * different words in the preview: an import that loses its own chord, and an
 * import that quietly takes one away from something else.
 */
export function findShortcutShadowing(
  actionId: ShortcutActionId,
  chord: KeyChord,
  resolution: ShortcutResolutionInput = {}
): ShortcutShadowing | null {
  const definition = getShortcutDefinition(actionId);
  if (!definition) return null;

  let leader = definition;
  let shadowed: ShortcutDefinition | null = null;
  // Tracked separately from `leader` on purpose. Classifying from the single
  // highest-precedence claimant is wrong whenever a `simulator` binding sits on
  // top of an always-in-stack one: the simulator claim reads "conditional" and
  // hides the collision underneath, so a caller that tolerates conditional
  // shadows applies a chord that is dead whenever no simulation is focused.
  // That shipped Oriedita's Fold key onto `F` and had it run the Auxiliary line
  // type instead, because `cp.action.line-type.auxiliary` also holds `F` in the
  // crease-pattern scope.
  let alwaysPresentLeader = definition;
  /**
   * A claimant that may not answer the chord, and so does not make `definition`
   * dead. Two kinds, for two different reasons:
   *
   * - **`simulator` scope**, which is in the stack only while a simulation owns
   *   the keyboard. This one is relative to `asked`: a simulator binding is never
   *   dispatched from a stack without its own scope, so from its point of view
   *   its own scope is always there and a sibling simulator claim is an ordinary
   *   same-scope collision, not a deferral.
   * - **A declining viewport binding**, which is always in the stack but hands
   *   the chord on when it does not apply. Not relative to anything — it is a
   *   property of the candidate alone, so no `asked`-side exemption applies.
   *
   * Both were once a single hard-coded scope check, which is why `Delete` used to
   * read as a collision with `viewport.delete` when the binding it really costs
   * is `edit.delete` underneath.
   */
  const mayNotAnswer = (candidate: ShortcutDefinition): boolean =>
    (definition.scope !== 'simulator' && candidate.scope === 'simulator') ||
    shortcutMayDecline(candidate.id);

  for (const candidate of SHORTCUT_DEFINITIONS) {
    if (candidate.id === actionId) continue;
    if (
      !getResolvedShortcuts(candidate.id, resolution).some((candidateChord) =>
        keyChordEquals(candidateChord, chord)
      )
    ) {
      continue;
    }
    if (!shadowed || shortcutDispatchPrecedes(candidate, shadowed)) shadowed = candidate;
    if (shortcutDispatchPrecedes(candidate, leader)) leader = candidate;
    if (!mayNotAnswer(candidate) && shortcutDispatchPrecedes(candidate, alwaysPresentLeader)) {
      alwaysPresentLeader = candidate;
    }
  }

  if (!shadowed) return null;
  const kind = shortcutShadowingKind(definition, alwaysPresentLeader);

  // Report the claimant that *explains the classification*, which is not always
  // the top one. On a hard shadow the caller needs the always-in-stack blocker —
  // naming the simulator binding sitting above it points the user at something
  // that is not the reason their key is dead. On a conditional shadow the
  // simulator binding is the whole story, so the top claimant is right.
  if (kind === 'hard' && alwaysPresentLeader.id !== actionId) {
    return { definition: alwaysPresentLeader, winnerId: alwaysPresentLeader.id, kind };
  }
  return { definition: shadowed, winnerId: leader.id, kind };
}

/**
 * A loss to a claimant that may not answer is a deferral, not a death — see
 * {@link ShortcutShadowing.kind} and {@link shortcutMayDecline}. Anything else is
 * hard: `global` is always in the stack, `viewport` is too unless the binding
 * declines, and `crease-pattern` is whenever the CP canvas is the editing
 * context, which is the context these bindings exist to serve.
 */
function shortcutShadowingKind(
  asked: ShortcutDefinition,
  alwaysPresentLeader: ShortcutDefinition
): 'hard' | 'conditional' {
  // Conditional only when nothing that shares every stack with `asked` beats it —
  // i.e. the chord reaches `asked` in every stack its own scope appears in. Any
  // such winner makes it hard, however many simulator claimants happen to
  // outrank that winner.
  return alwaysPresentLeader.id !== asked.id ? 'hard' : 'conditional';
}

export function parseOrieditaKeyStroke(
  value: string,
  options: { ctrlAsPrimary?: boolean } = {}
): KeyChord | null {
  const parts = value.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return null;

  const chord: KeyChord = { key: '' };
  for (const part of parts) {
    const token = part.toLowerCase();
    if (token === 'ctrl' || token === 'control') {
      if (options.ctrlAsPrimary) chord.primary = true;
      else chord.ctrl = true;
    } else if (token === 'meta' || token === 'cmd' || token === 'command') {
      chord.meta = true;
    } else if (token === 'alt' || token === 'option') {
      chord.alt = true;
    } else if (token === 'shift') {
      chord.shift = true;
    } else if (token === 'pressed') {
      continue;
    } else {
      chord.key = normalizeKey(token);
    }
  }

  return chord.key ? normalizeKeyChord(chord) : null;
}

export function keyChordFromKeyboardEvent(event: KeyboardEvent): KeyChord | null {
  const key = normalizeKey(event.key);
  if (!key || isModifierKey(key)) return null;
  const primary = event.metaKey || event.ctrlKey;
  return normalizeKeyChord({
    key,
    primary,
    ctrl: event.ctrlKey && !primary,
    meta: event.metaKey && !primary,
    alt: event.altKey,
    shift: event.shiftKey,
  });
}

export function normalizeKeyChord(chord: KeyChord): KeyChord {
  return {
    key: normalizeKey(chord.key),
    primary: chord.primary || undefined,
    ctrl: chord.ctrl || undefined,
    meta: chord.meta || undefined,
    alt: chord.alt || undefined,
    shift: chord.shift || undefined,
  };
}

export function keyChordEquals(a: KeyChord, b: KeyChord): boolean {
  return keyChordId(a) === keyChordId(b);
}

export function keyChordId(chord: KeyChord): string {
  const normalized = normalizeKeyChord(chord);
  return [
    normalized.primary ? 'primary' : '',
    normalized.ctrl ? 'ctrl' : '',
    normalized.meta ? 'meta' : '',
    normalized.alt ? 'alt' : '',
    normalized.shift ? 'shift' : '',
    normalized.key,
  ]
    .filter(Boolean)
    .join('+');
}

export function formatKeyChord(
  chord: KeyChord,
  options: { platform?: 'mac' | 'other' } = {}
): string {
  const platform = options.platform ?? (isApplePlatform() ? 'mac' : 'other');
  const normalized = normalizeKeyChord(chord);
  const parts = [
    normalized.primary ? (platform === 'mac' ? 'Cmd' : 'Ctrl') : '',
    normalized.ctrl ? 'Ctrl' : '',
    normalized.meta ? (platform === 'mac' ? 'Cmd' : 'Meta') : '',
    normalized.alt ? (platform === 'mac' ? 'Option' : 'Alt') : '',
    normalized.shift ? 'Shift' : '',
    displayKey(normalized.key),
  ].filter(Boolean);
  return parts.join('+');
}

export function classifyReservedKey(chord: KeyChord): ReservedKeyClassification {
  const id = keyChordId(chord);
  if (
    id === 'primary+l' ||
    id === 'primary+w' ||
    id === 'primary+t' ||
    id === 'primary+shift+t' ||
    id === 'primary+shift+i' ||
    id === 'f5'
  ) {
    return 'hard-reserved';
  }
  if (id === 'primary+r' || id === 'primary+shift+r') return 'soft-reserved';
  return 'allowed';
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  switch (lower) {
    case ' ':
    case 'spacebar':
      return 'space';
    case 'esc':
      return 'escape';
    case 'del':
      return 'delete';
    case 'return':
      return 'enter';
    case 'plus':
      return '+';
    case 'minus':
      return '-';
    default:
      return lower;
  }
}

function displayKey(key: string): string {
  switch (key) {
    case 'delete':
      return 'Delete';
    case 'backspace':
      return 'Backspace';
    case 'escape':
      return 'Esc';
    case 'enter':
      return 'Enter';
    case 'space':
      return 'Space';
    case ',':
    case '.':
    case '/':
    case '-':
    case '=':
    case '+':
      return key;
    default:
      return key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/u, 'F$1');
  }
}

function isModifierKey(key: string): boolean {
  return (
    key === 'control' ||
    key === 'ctrl' ||
    key === 'meta' ||
    key === 'shift' ||
    key === 'alt'
  );
}
