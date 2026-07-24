import type { MenuActionId } from '../commands/menuActions';
import {
  ORISTUDIO_CP_ACTIONS,
  type OristudioCpActionId,
} from '../lib/oristudioCpActions';
import { isApplePlatform } from '../lib/platform';

export type ShortcutScope = 'global' | 'crease-pattern' | 'viewport';
export type ViewportShortcutId =
  | 'viewport.zoomIn'
  | 'viewport.zoomOut'
  | 'viewport.fit'
  | 'viewport.actualSize'
  | 'viewport.pan';
export type ShortcutActionId = MenuActionId | OristudioCpActionId | ViewportShortcutId;
export type ShortcutTarget = 'menu' | 'cp-action' | 'viewport';
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

  // -- Draw / construct --------------------------------------------------
  drawCreaseFreeAction: 'Z', // free line
  // Ori Studio addition: upstream Oriedita has no Space handler at all, but the
  // grid-restricted line is frequent enough to deserve the biggest key, and it
  // pairs with Z for the free line.
  drawCreaseRestrictedAction: 'SPACE',
  perpendicularDrawAction: 'Y',
  angleBisectorAction: 'B',
  lengthenCrease2Action: 'E',
  makeFlatFoldableAction: 'T', // flat-foldable line (the rail-visible tool)
  deg2Action: 'R', // radial / angle-restricted snapping (22.5, 30, 15 deg)
  fishBoneDrawAction: 'H', // Oriedita labels this button "gridFill"
  rabbitEarAction: 'ctrl B',
  continuousSymmetricDrawAction: 'ctrl R',
  doubleSymmetricDrawAction: 'ctrl G',
  reflectAction: 'ctrl M',
  // Brandon's layout claims R for radial snapping, so Mirror Line takes M —
  // mnemonic, and freed when the line types moved onto the home row.
  symmetricDrawAction: 'M',

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
  menuShortcut('file.new', 'New', 'File', { primary: true, key: 'n' }),
  menuShortcut('file.open', 'Open...', 'File', { primary: true, key: 'o' }),
  menuShortcut('file.save', 'Save', 'File', { primary: true, key: 's' }),
  menuShortcut('file.saveAs', 'Save As...', 'File', { primary: true, shift: true, key: 's' }),
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
  menuShortcut('cp.checkCamv', 'Check CAMV', 'Crease Pattern', {
    primary: true,
    shift: true,
    key: 'm',
  }),
];

const VIEWPORT_SHORTCUTS: ShortcutDefinition[] = [
  // The bare 6/5 chords come from the Oriedita layout, so the left hand can
  // zoom without reaching for a modifier.
  viewportShortcut('viewport.zoomIn', 'Zoom In', [{ primary: true, key: '=' }, { key: '6' }]),
  viewportShortcut('viewport.zoomOut', 'Zoom Out', [{ primary: true, key: '-' }, { key: '5' }]),
  viewportShortcut('viewport.fit', 'Fit To View', { primary: true, key: '0' }),
  viewportShortcut('viewport.actualSize', 'Actual Size', { primary: true, key: '1' }),
  viewportShortcut('viewport.pan', 'Pan (hand tool)', { key: '1' }),
];

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  ...MENU_SHORTCUTS,
  ...buildCpShortcutDefinitions(),
  ...VIEWPORT_SHORTCUTS,
];

const SHORTCUT_DEFINITION_BY_ID = new Map(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition])
);

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
  defaultChord: KeyChord | KeyChord[]
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
  overrides: ShortcutOverrides = {}
): KeyChord | null {
  return getResolvedShortcuts(id, overrides)[0] ?? null;
}

export function getResolvedShortcuts(
  id: ShortcutActionId,
  overrides: ShortcutOverrides = {}
): KeyChord[] {
  const definition = getShortcutDefinition(id);
  if (!definition) return [];
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    const overrideChords = (overrides[id] ?? [])
      .map(normalizeKeyChord)
      .filter((chord) => chord.key);
    return shortcutKeepsDefaultChords(id)
      ? mergeKeyChords(definition.defaultChords, overrideChords)
      : overrideChords;
  }
  return definition.defaultChords;
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
  overrides: ShortcutOverrides = {}
): string | undefined {
  const chords = getResolvedShortcuts(id, overrides);
  return chords.length > 0 ? chords.map((chord) => formatKeyChord(chord)).join(' / ') : undefined;
}

export function findShortcutConflict(
  actionId: ShortcutActionId,
  chord: KeyChord,
  overrides: ShortcutOverrides = {}
): ShortcutDefinition | null {
  const definition = getShortcutDefinition(actionId);
  if (!definition) return null;

  for (const candidate of SHORTCUT_DEFINITIONS) {
    if (candidate.id === actionId) continue;
    if (!shortcutScopesOverlap(definition.scope, candidate.scope)) continue;
    if (
      getResolvedShortcuts(candidate.id, overrides).some((candidateChord) =>
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
