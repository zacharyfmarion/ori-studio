import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Check,
  Download,
  Keyboard,
  LayoutDashboard,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { OrieditaImportDialog } from './settings/OrieditaImportDialog';
import { SettingsToggleRow } from './settings/SettingsToggleRow';
import { UpdatesSection } from './settings/UpdatesSection';
import { ANALYTICS_EVENTS, track, useAnalytics } from '../analytics';
import { detectSystemLocale, SUPPORTED_LOCALES, SYSTEM_LOCALE } from '../i18n/locales';
import {
  CP_MAX_SNAP_RADIUS,
  CP_MIN_SNAP_RADIUS,
  hasCoarsePointer,
  resolveCpSnapRadius,
} from '../lib/cpSnapRadiusSetting';
import {
  shortcutActionLabel,
  shortcutCategoryLabel,
  shortcutScopeLabel,
} from '../i18n/shortcutLabels';
import { useLocaleStore } from '../store/localeStore';
import { NumberField } from './ui/NumberField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import {
  describeReservedKey,
  findShortcutShadowing,
  formatKeyChord,
  getDefaultShortcutChords,
  isShortcutBindable,
  getResolvedShortcuts,
  getShortcutDefinition,
  keyChordEquals,
  keyChordFromKeyboardEvent,
  keyChordId,
  SHORTCUT_DEFINITIONS,
  shortcutKeepsDefaultChords,
  shortcutMayDecline,
  shortcutLabelForAction,
  type KeyChord,
  type ReservedKeyReason,
  type ShortcutActionId,
  type ShortcutDefaultsSource,
  type ShortcutDefinition,
  type ShortcutOverrides,
  type ShortcutResolution,
} from '../keyboard/shortcuts';
import { requestConfirmation } from '../store/commandDialogStore';
import { useLayoutStore } from '../store/layoutStore';
import { type SettingsTab, useSettingsStore } from '../store/settingsStore';
import { useShortcutStore } from '../store/shortcutStore';
import { useThemeStore } from '../store/themeStore';
import type { TreeMakerTheme } from '../themes';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

const TABS: Array<{ key: SettingsTab; icon: typeof Palette }> = [
  { key: 'general', icon: SlidersHorizontal },
  { key: 'appearance', icon: Palette },
  { key: 'shortcuts', icon: Keyboard },
  { key: 'workspace', icon: LayoutDashboard },
];

/** Localized tab label. Literal `t()` calls keep the keys extractable. */
function tabLabel(t: TFunction, key: SettingsTab): string {
  switch (key) {
    case 'general':
      return t('dialogs:settings.tab.general', 'General');
    case 'appearance':
      return t('dialogs:settings.tab.appearance', 'Appearance');
    case 'shortcuts':
      return t('dialogs:settings.tab.shortcuts', 'Shortcuts');
    case 'workspace':
      return t('dialogs:settings.tab.workspace', 'Workspace');
  }
}

/**
 * Which pane opens when nothing asked for one — which is every real open, since
 * both production callers pass no tab.
 *
 * Falls back to the *first* tab rather than a named one. Naming it is how the
 * pane that opens and the pane at the top of the list drift apart: this read
 * `'appearance'` back when Appearance happened to be first, so putting anything
 * ahead of it would have opened the dialog on its second entry.
 */
function resolveInitialTab(initialTab: SettingsTab | null): SettingsTab {
  const [first] = TABS;
  return initialTab && TABS.some((tab) => tab.key === initialTab) ? initialTab : first.key;
}

function ThemeCard({
  theme,
  selected,
  onSelect,
}: {
  theme: TreeMakerTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="settings-theme-card"
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="settings-theme-card__header">
        <span className="settings-theme-card__name">{theme.name}</span>
        {selected && <Check size={14} aria-hidden="true" />}
      </span>
      <span className="settings-theme-card__swatches" aria-hidden="true">
        <span style={{ background: theme.colors['bg.primary'] }} />
        <span style={{ background: theme.colors['bg.secondary'] }} />
        <span style={{ background: theme.colors['accent.primary'] }} />
        <span style={{ background: theme.colors['text.primary'] }} />
        <span style={{ background: theme.colors['status.danger'] }} />
        <span style={{ background: theme.colors['status.success'] }} />
      </span>
    </button>
  );
}

function LanguageSection() {
  const { t } = useTranslation();
  const preference = useLocaleStore((state) => state.preference);
  const setLocale = useLocaleStore((state) => state.setLocale);

  // Annotate "System default" with the language it currently resolves to.
  const detected = detectSystemLocale();
  const detectedName =
    SUPPORTED_LOCALES.find((l) => l.code === detected)?.nativeName ?? detected;

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{t('dialogs:settings.language.title', 'Language')}</h3>
      <Select value={preference} onValueChange={setLocale}>
        <SelectTrigger className="settings-full-width" aria-label={t('dialogs:settings.language.title', 'Language')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SYSTEM_LOCALE}>
            {t('dialogs:settings.language.system', 'System default')} — {detectedName}
          </SelectItem>
          {SUPPORTED_LOCALES.map((option) => (
            <SelectItem key={option.code} value={option.code}>
              {option.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

function AppearanceTab() {
  const { t } = useTranslation();
  const currentTheme = useThemeStore((state) => state.currentTheme);
  const presetThemes = useThemeStore((state) => state.presetThemes);
  const setTheme = useThemeStore((state) => state.setTheme);

  const themeCategories = useMemo(() => {
    const grouped = presetThemes.reduce<Record<TreeMakerTheme['type'], TreeMakerTheme[]>>(
      (acc, theme) => {
        acc[theme.type].push(theme);
        return acc;
      },
      { dark: [], light: [] }
    );
    return [
      { key: 'dark', label: t('dialogs:settings.appearance.dark', 'Dark'), themes: grouped.dark },
      { key: 'light', label: t('dialogs:settings.appearance.light', 'Light'), themes: grouped.light },
    ].filter((section) => section.themes.length > 0);
  }, [presetThemes, t]);

  return (
    <div className="settings-tab">
      <LanguageSection />
      {themeCategories.map((section) => (
        <section key={section.key} className="settings-section">
          <h3 className="settings-section__title">{section.label}</h3>
          <div className="settings-theme-grid">
            {section.themes.map((theme) => (
              <ThemeCard
                key={theme.name}
                theme={theme}
                selected={currentTheme.name === theme.name}
                onSelect={() => setTheme(theme)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * How the application behaves — as distinct from how it edits, which is the
 * Workspace tab.
 *
 * Updates renders nothing off the desktop build, so in a browser this tab is
 * Startup and Privacy alone.
 */
function GeneralTab() {
  const { t } = useTranslation();
  const showWelcomeOnStartup = useSettingsStore((state) => state.showWelcomeOnStartup);
  const setShowWelcomeOnStartup = useSettingsStore((state) => state.setShowWelcomeOnStartup);
  const analyticsEnabled = useSettingsStore((state) => state.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore((state) => state.setAnalyticsEnabled);
  const analytics = useAnalytics();

  return (
    <div className="settings-tab">
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.general.startup', 'Startup')}
        </h3>
        <SettingsToggleRow
          label={t('dialogs:settings.general.showWelcome', 'Show welcome screen on startup')}
          checked={showWelcomeOnStartup}
          onChange={setShowWelcomeOnStartup}
        />
      </section>
      <UpdatesSection />
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.general.privacy', 'Privacy')}
        </h3>
        <SettingsToggleRow
          label={t(
            'dialogs:settings.general.analytics',
            'Send anonymous usage analytics and crash reports to help improve Ori Studio'
          )}
          checked={analyticsEnabled}
          onChange={(enabled) => {
            // Persist the preference, then apply it to the analytics client:
            // opt in/out, (re)identify or reset, and record the change itself.
            // Crash reporting rides the same switch, but needs no call here —
            // `MonitoringRuntimeProvider` reacts to the store value directly.
            setAnalyticsEnabled(enabled);
            analytics.setAnalyticsEnabled(enabled, { capturePreferenceChange: true });
          }}
        />
      </section>
    </div>
  );
}

/**
 * The field's bound, resolved against the live pointer so that it and the
 * store's hydration are the same law rather than two that happen to agree.
 *
 * `NumberField` already refuses to commit an entry it cannot read, so this only
 * ever sees a finite number and today returns exactly what `clampCpSnapRadius`
 * would. It goes through the resolver anyway to keep one entry point, not
 * because a second default is reachable here.
 */
function normalizeCpSnapRadius(value: number): number {
  return resolveCpSnapRadius(value, hasCoarsePointer());
}

function WorkspaceTab() {
  const { t } = useTranslation();
  const resetLayout = useLayoutStore((state) => state.resetLayout);
  const foldWarningEnabled = useSettingsStore((state) => state.foldWarningEnabled);
  const setFoldWarningEnabled = useSettingsStore((state) => state.setFoldWarningEnabled);
  const cpWheelGesture = useSettingsStore((state) => state.cpWheelGesture);
  const setCpWheelGesture = useSettingsStore((state) => state.setCpWheelGesture);
  const cpSnapRadius = useSettingsStore((state) => state.cpSnapRadius);
  const setCpSnapRadius = useSettingsStore((state) => state.setCpSnapRadius);
  const snapRadiusId = useId();
  const snapRadiusLabel = t('dialogs:settings.workspace.snapRadius', 'Snap radius');

  return (
    <div className="settings-tab">
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.workspace.folding', 'Folding')}
        </h3>
        <SettingsToggleRow
          label={t(
            'dialogs:settings.workspace.foldWarning',
            'Warn before folding a crease pattern with flat-foldability errors'
          )}
          checked={foldWarningEnabled}
          onChange={setFoldWarningEnabled}
        />
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.workspace.creasePatternCanvas', 'Crease pattern canvas')}
        </h3>
        {/* Default first. `value` is here so the radios are addressable by what
            they mean rather than by their position in this list. */}
        <label className="settings-checkbox">
          <input
            type="radio"
            name="cp-wheel-gesture"
            value="zoom"
            checked={cpWheelGesture === 'zoom'}
            onChange={() => setCpWheelGesture('zoom')}
          />
          {t('dialogs:settings.workspace.wheelZooms', 'Scroll zooms')}
        </label>
        <label className="settings-checkbox">
          <input
            type="radio"
            name="cp-wheel-gesture"
            value="pan"
            checked={cpWheelGesture === 'pan'}
            onChange={() => setCpWheelGesture('pan')}
          />
          {t('dialogs:settings.workspace.wheelPans', 'Scroll pans, pinch zooms')}
        </label>
        <p className="settings-toggle-row__desc">
          {t(
            'dialogs:settings.workspace.wheelGestureHint',
            'Pinch and Cmd/Ctrl+scroll always zoom, whichever you choose.'
          )}
        </p>
        {/* The modal's own row: copy on the left, control on the right, no box.
            `.control-row` is the inspector-panel idiom — indented, with a bottom
            divider — and reads as foreign in here. */}
        <div className="settings-toggle-row settings-toggle-row--field">
          <span className="settings-toggle-row__copy">
            <label className="settings-toggle-row__label" htmlFor={snapRadiusId}>
              {snapRadiusLabel}
            </label>
            <span className="settings-toggle-row__desc">
              {t(
                'dialogs:settings.workspace.snapRadiusHint',
                'How close the pointer has to come to a vertex, crease or grid point to snap to it, in paper units — the paper is 400 across, so this is the same number as Oriedita uses.'
              )}
            </span>
          </span>
          <span className="settings-toggle-row__field">
            <NumberField
              id={snapRadiusId}
              label={snapRadiusLabel}
              value={cpSnapRadius}
              min={CP_MIN_SNAP_RADIUS}
              max={CP_MAX_SNAP_RADIUS}
              step={1}
              normalize={normalizeCpSnapRadius}
              onCommit={setCpSnapRadius}
            />
          </span>
        </div>
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">{t('dialogs:settings.workspace.layout', 'Layout')}</h3>
        <Button
          size="md"
          variant="secondary"
          className="settings-full-width"
          onClick={() => {
            void requestConfirmation({
              title: t('dialogs:settings.workspace.resetTitle', 'Reset Workspace Layout'),
              message: t('dialogs:settings.workspace.resetMessage', 'Restore the default layout for the current workspace?'),
              confirmLabel: t('dialogs:common.reset', 'Reset'),
              tone: 'danger',
            }).then((confirmed) => {
              if (!confirmed) return;
              resetLayout();
            });
          }}
        >
          <RotateCcw size={14} />
          {t('dialogs:settings.workspace.resetButton', 'Reset Workspace Layout')}
        </Button>
      </section>
    </div>
  );
}

/**
 * Lets a tab tell the Settings modal that it has opened a dialog of its own.
 *
 * Both this modal and a nested dialog listen for Escape on `window` in the
 * capture phase, and the modal's listener is registered first — so
 * `stopPropagation` from the inner one cannot suppress it, and Escape in the
 * import review was tearing down the whole Settings modal instead of returning
 * the user to the Shortcuts list they came from.
 */
const NestedDialogContext = createContext<(open: boolean) => void>(() => {});

/** Chords as one comparable string, so two resolutions can be diffed by value. */
function chordListId(chords: KeyChord[]): string {
  return chords.map((chord) => keyChordId(chord)).join(' ');
}

interface DefaultsSourceChange {
  definition: ShortcutDefinition;
  /** Where the shortcut lands after the switch; empty means it becomes unassigned. */
  chords: KeyChord[];
}

interface DefaultsSourceClash {
  definition: ShortcutDefinition;
  chord: KeyChord;
  blocker: ShortcutDefinition;
}

interface DefaultsSourceDiff {
  changes: DefaultsSourceChange[];
  unaffectedCustomized: number;
  clashes: DefaultsSourceClash[];
}

/**
 * The always-in-stack definition that also answers `chord` under `resolution`.
 *
 * {@link findShortcutShadowing} reports a `hard` shadow only when the binding you
 * asked about is the one that *loses*. A source switch creates the collision in
 * both directions: the user's override can outrank a binding the new layout just
 * introduced, leaving that binding dead on arrival while the shadowing call
 * reports `conditional` because nothing outranks the override. Same collision,
 * same warning — so the co-claimant is looked up directly.
 *
 * Claimants that may not answer the chord are excluded, because they leave
 * nothing dead: `simulator` is in the stack only while a simulation owns the
 * keyboard, so `C`, `L` and `R` coexist with CP tools by design, and a viewport
 * binding that {@link shortcutMayDecline} hands the chord on when it does not
 * apply. Skipping the latter is what makes `Delete` name `edit.delete` — the
 * global binding a crease-pattern capture really costs — instead of
 * `viewport.delete`, which was never going to fight for it.
 *
 * Two definitions carrying one upstream action are one verb wearing two ids, so
 * they are not a collision either.
 */
function findChordCoClaimant(
  definition: ShortcutDefinition,
  chord: KeyChord,
  resolution: ShortcutResolution
): ShortcutDefinition | null {
  if (definition.scope === 'simulator') return null;
  for (const candidate of SHORTCUT_DEFINITIONS) {
    if (candidate.id === definition.id || candidate.scope === 'simulator') continue;
    if (shortcutMayDecline(candidate.id)) continue;
    if (definition.upstreamAction && definition.upstreamAction === candidate.upstreamAction) {
      continue;
    }
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

/**
 * What switching the defaults source does to the keymap.
 *
 * Read back out of the resolver under each source rather than compared table to
 * table, so the confirmation counts cannot drift from the switch that follows.
 */
function diffDefaultsSource(
  overrides: ShortcutOverrides,
  from: ShortcutDefaultsSource,
  to: ShortcutDefaultsSource
): DefaultsSourceDiff {
  const before: ShortcutResolution = { overrides, defaultsSource: from };
  const after: ShortcutResolution = { overrides, defaultsSource: to };
  const changes: DefaultsSourceChange[] = [];
  const clashes: DefaultsSourceClash[] = [];
  let unaffectedCustomized = 0;

  for (const definition of SHORTCUT_DEFINITIONS) {
    const nextChords = getResolvedShortcuts(definition.id, after);
    const changed =
      chordListId(getResolvedShortcuts(definition.id, before)) !== chordListId(nextChords);
    if (changed) changes.push({ definition, chords: nextChords });

    if (!Object.prototype.hasOwnProperty.call(overrides, definition.id)) continue;
    // Overrides survive the switch, so a key the user set by hand can end up
    // sitting on a different base. That is the one thing the switch can break
    // without being asked to, so it is named rather than resolved.
    const clash = nextChords
      .map((chord) => ({ chord, blocker: findChordCoClaimant(definition, chord, after) }))
      .find(
        (entry) =>
          entry.blocker !== null && findChordCoClaimant(definition, entry.chord, before) === null
      );
    if (clash?.blocker) {
      clashes.push({ definition, chord: clash.chord, blocker: clash.blocker });
    }
    // A customization the switch leaves colliding is the opposite of unaffected;
    // counting it in both lines reports one shortcut as two.
    if (!changed && !clash) unaffectedCustomized += 1;
  }
  return { changes, unaffectedCustomized, clashes };
}

/** How many moves the confirmation names before falling back to "and N others". */
const DEFAULTS_CHANGE_EXAMPLES = 3;

function describeDefaultsSourceChange(t: TFunction, change: DefaultsSourceChange): string {
  const label = shortcutActionLabel(t, change.definition);
  return change.chords.length > 0
    ? t('dialogs:settings.shortcuts.defaultsMove', '{{label}} moves to {{chord}}', {
        label,
        chord: change.chords.map((chord) => formatKeyChord(chord)).join(' / '),
      })
    : t('dialogs:settings.shortcuts.defaultsUnbind', '{{label}} becomes unassigned', { label });
}

function defaultsSourceMessage(t: TFunction, diff: DefaultsSourceDiff): string {
  const examples = diff.changes
    .slice(0, DEFAULTS_CHANGE_EXAMPLES)
    .map((change) => describeDefaultsSourceChange(t, change));
  const remaining = diff.changes.length - examples.length;
  const parts = [
    t('dialogs:settings.shortcuts.defaultsChangeCount', {
      count: diff.changes.length,
      defaultValue_one: 'This changes 1 shortcut.',
      defaultValue_other: 'This changes {{count}} shortcuts.',
    }),
    remaining > 0
      ? t('dialogs:settings.shortcuts.defaultsChangeExamplesMore', {
          count: remaining,
          moves: examples.join(', '),
          defaultValue_one: '{{moves}}, and 1 other.',
          defaultValue_other: '{{moves}}, and {{count}} others.',
        })
      : t('dialogs:settings.shortcuts.defaultsChangeExamples', '{{moves}}.', {
          moves: examples.join(', '),
        }),
  ];
  if (diff.unaffectedCustomized > 0) {
    parts.push(
      t('dialogs:settings.shortcuts.defaultsChangeCustomized', {
        count: diff.unaffectedCustomized,
        defaultValue_one: '1 shortcut you customized is unaffected.',
        defaultValue_other: '{{count}} shortcuts you customized are unaffected.',
      })
    );
  }
  if (diff.clashes.length > 0) {
    const list = diff.clashes
      .slice(0, DEFAULTS_CHANGE_EXAMPLES)
      .map((clash) =>
        t(
          'dialogs:settings.shortcuts.defaultsClashItem',
          'your {{label}} is on {{chord}}, which {{blocker}} also uses',
          {
            label: shortcutActionLabel(t, clash.definition),
            chord: formatKeyChord(clash.chord),
            blocker: shortcutActionLabel(t, clash.blocker),
          }
        )
      )
      .join('; ');
    parts.push(
      t('dialogs:settings.shortcuts.defaultsChangeClash', {
        count: diff.clashes.length,
        clashes: list,
        defaultValue_one: '1 shortcut you customized now clashes: {{clashes}}.',
        defaultValue_other: '{{count}} shortcuts you customized now clash: {{clashes}}.',
      })
    );
  }
  return parts.join(' ');
}

type CaptureDecision =
  | { kind: 'assign' }
  /** Something else owns the chord and may not be moved aside. */
  | { kind: 'refuse'; blocker: ShortcutDefinition }
  /** The target itself cannot hold a binding, whatever the chord is. */
  | { kind: 'not-bindable' }
  | { kind: 'unbind'; blocker: ShortcutDefinition };

/**
 * What capturing a chord should do about whoever already answers it.
 *
 * Asks {@link findShortcutShadowing}, not `findShortcutConflict`: the latter
 * answers `null` for a crease-pattern binding shadowing a global one, which is
 * exactly the collision a rebind creates.
 *
 * `kind` is not the whole answer though, because it is asked from one side: it
 * says `hard` only when the binding being captured is the one that *loses*. A
 * capture that outranks an always-in-stack claimant reads `conditional` — nothing
 * beats it — while leaving that claimant holding a chord it can never answer,
 * still displayed in this very list as though it worked. That is the same
 * collision seen from the other end, and the import path already treats both
 * directions alike (`blockedBy` in `importPlan.ts`: "if the import wins, the
 * blocker's chord is dead instead ... the fix is the same"). So a `conditional`
 * answer is re-asked as {@link findChordCoClaimant}, which ignores direction and
 * excludes the two non-collisions — a `simulator` claimant, in the stack only
 * while a simulation owns the keyboard, and one verb wearing two ids.
 */
/**
 * What to tell the user about a chord someone else owns.
 *
 * One message per {@link ReservedKeyReason} rather than one per strength: the
 * web refusal is worth softening with "the desktop app can" and the desktop
 * refusal is not, and a Windows warning about the web engine is a different
 * claim from a browser warning about reload.
 */
function reservedKeyMessage(
  t: TFunction,
  chord: KeyChord,
  reason: ReservedKeyReason | null
): string | null {
  const values = { chord: formatKeyChord(chord) };
  switch (reason) {
    case 'browser-chrome':
      return t(
        'dialogs:settings.shortcuts.reserved',
        '{{chord}} is reserved by the browser. The desktop app can use it.',
        values
      );
    case 'browser-reload':
      return t(
        'dialogs:settings.shortcuts.softReserved',
        '{{chord}} was assigned, but some browsers may reserve it.',
        values
      );
    case 'app-menu':
      return t(
        'dialogs:settings.shortcuts.reservedAppMenu',
        '{{chord}} belongs to the macOS app menu. Binding it would stop that command working.',
        values
      );
    case 'webview-accelerator':
      return t(
        'dialogs:settings.shortcuts.softReservedWebview',
        '{{chord}} was assigned, but the desktop web engine may take it first.',
        values
      );
    case null:
      return null;
  }
}

function decideCapture(
  definition: ShortcutDefinition,
  chord: KeyChord,
  resolution: ShortcutResolution
): CaptureDecision {
  // Asked before anything else, and shared with the importer: an action that
  // cannot hold an override must not be assignable here either. Capture had no
  // such check, so binding a not-implemented stub would destroy whatever held
  // the chord and then do nothing — the import refuses the same action outright.
  if (!isShortcutBindable(definition.id)) return { kind: 'not-bindable' };
  const shadowing = findShortcutShadowing(definition.id, chord, resolution);
  if (!shadowing) return { kind: 'assign' };
  const blocker =
    shadowing.kind === 'hard'
      ? shadowing.definition
      : findChordCoClaimant(definition, chord, resolution);
  // Two definitions carrying one upstream action are one verb wearing two ids,
  // so the chord reaches what the user meant either way.
  //
  // A capture that {@link shortcutMayDecline} displaces nothing either: it hands
  // the chord on when it does not apply, so whatever it outranks still answers
  // the rest of the time — the mechanism `viewport.delete` and `edit.delete`
  // already coexist through. The `blocker.scope !== 'viewport'` guard is what
  // keeps that from swallowing a same-scope collision: within one scope the
  // dispatcher takes the first definition matching the chord and, if that one
  // declines, continues to the next *scope* rather than the next definition —
  // so a viewport sibling on the same chord is unreachable, decline or not.
  //
  // This clause used to read `definition.scope === 'viewport'`, which handed the
  // same free pass to `viewport.zoomOut` — a capture that would have killed the
  // blocker outright, silently.
  if (
    !blocker ||
    (definition.upstreamAction && definition.upstreamAction === blocker.upstreamAction) ||
    (shortcutMayDecline(definition.id) && blocker.scope !== 'viewport')
  ) {
    return { kind: 'assign' };
  }
  // Undo/Redo merge their overrides with the defaults instead of replacing them,
  // so unbinding them would promise a change that cannot happen. That is the only
  // binding left that cannot be offered: a declining blocker never reaches here
  // (it is transparent, so `findChordCoClaimant` reports what sits beneath it
  // instead), and every other viewport binding owns its chord outright and is
  // evictable like anything else.
  if (shortcutKeepsDefaultChords(blocker.id)) {
    return { kind: 'refuse', blocker };
  }
  return { kind: 'unbind', blocker };
}

function ShortcutsTab() {
  const { t } = useTranslation();
  const overrides = useShortcutStore((state) => state.overrides);
  const defaultsSource = useShortcutStore((state) => state.defaultsSource);
  const setShortcut = useShortcutStore((state) => state.setShortcut);
  const assignShortcut = useShortcutStore((state) => state.assignShortcut);
  const clearShortcut = useShortcutStore((state) => state.clearShortcut);
  const resetShortcut = useShortcutStore((state) => state.resetShortcut);
  const resetAllShortcuts = useShortcutStore((state) => state.resetAllShortcuts);
  const setDefaultsSource = useShortcutStore((state) => state.setDefaultsSource);
  const resolution = useMemo<ShortcutResolution>(
    () => ({ overrides, defaultsSource }),
    [defaultsSource, overrides]
  );
  const [search, setSearch] = useState('');
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);
  /**
   * Capture feedback, and the row it belongs to.
   *
   * Row-scoped because this list is long and scrolls. A single message line
   * above the table is off-screen exactly when it is needed — you are looking
   * at the row you just clicked, several screens down, and the refusal appears
   * somewhere you cannot see, so a key that *was* answered reads as a key that
   * did nothing. Every message this tab produces is about one row, so none of
   * them ever needed to live anywhere else.
   */
  const [feedback, setFeedback] = useState<{
    actionId: ShortcutActionId;
    text: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const setNestedDialogOpen = useContext(NestedDialogContext);
  useEffect(() => {
    setNestedDialogOpen(importing);
    return () => setNestedDialogOpen(false);
  }, [importing, setNestedDialogOpen]);

  useEffect(() => {
    if (!capturingId) return undefined;
    const say = (text: string | null) =>
      setFeedback(text ? { actionId: capturingId, text } : null);
    const onKeyDown = (event: KeyboardEvent) => {
      // Nothing outside the recorder may *act* on a key typed into it — without
      // this, rebinding onto an already-assigned chord would run that action on
      // the way past. Propagation stops for every key; whether the key is also
      // taken away from the host is decided per chord below, and those are two
      // separate questions that this handler used to answer with one line.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        setCapturingId(null);
        setFeedback(null);
        return;
      }
      const chord = keyChordFromKeyboardEvent(event);
      // Half a chord: every real one starts with a modifier held down. Leaving
      // it entirely alone costs nothing, since a bare modifier matches nothing.
      if (!chord) return;
      const reserved = describeReservedKey(chord);
      if (reserved.classification === 'hard-reserved') {
        // Refused *because the host owns the chord*, so preventDefault here
        // would take it from the host as well and hand it to nobody. That is
        // what stopped Cmd+Shift+I opening devtools while a capture was armed.
        say(reservedKeyMessage(t, chord, reserved.reason));
        return;
      }
      // Past here the chord is one we could hold, so it is ours to consume
      // whatever we decide about it.
      event.preventDefault();
      const definition = getShortcutDefinition(capturingId);
      if (!definition) return;
      const assignedMessage =
        reserved.classification === 'soft-reserved'
          ? reservedKeyMessage(t, chord, reserved.reason)
          : null;
      const decision = decideCapture(definition, chord, resolution);
      if (decision.kind === 'not-bindable') {
        say(
          t(
            'dialogs:settings.shortcuts.notBindable',
            '{{label}} cannot take a shortcut yet.',
            { label: shortcutActionLabel(t, definition) }
          )
        );
        return;
      }
      if (decision.kind === 'refuse') {
        say(t('dialogs:settings.shortcuts.alreadyAssigned', '{{chord}} is already assigned to {{label}}.', { chord: formatKeyChord(chord), label: shortcutActionLabel(t, decision.blocker) }));
        return;
      }
      if (decision.kind === 'unbind') {
        // Capture has to end before the confirmation opens: this listener runs in
        // the capture phase and swallows every key, including the dialog's own.
        const targetId = capturingId;
        const { blocker } = decision;
        const blockerLabel = shortcutActionLabel(t, blocker);
        setCapturingId(null);
        setFeedback(null);
        void requestConfirmation({
          title: t('dialogs:settings.shortcuts.unbindTitle', 'Unbind {{label}}?', { label: blockerLabel }),
          message: t(
            'dialogs:settings.shortcuts.unbindMessage',
            '{{blocker}} uses {{chord}}. Assigning it to {{label}} leaves {{blocker}} unassigned.',
            {
              blocker: blockerLabel,
              chord: formatKeyChord(chord),
              label: shortcutActionLabel(t, definition),
            }
          ),
          confirmLabel: t('dialogs:settings.shortcuts.unbindConfirm', 'Unbind and assign'),
          tone: 'danger',
        }).then((confirmed) => {
          if (!confirmed) return;
          assignShortcut(targetId, chord, { unbind: [blocker.id] });
          say(assignedMessage);
        });
        return;
      }
      setShortcut(capturingId, chord);
      setCapturingId(null);
      say(assignedMessage);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [assignShortcut, capturingId, resolution, setShortcut, t]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return SHORTCUT_DEFINITIONS.filter((definition) => {
      const currentLabel = shortcutLabelForAction(definition.id, resolution);
      if (assignedOnly && !currentLabel) return false;
      if (!query) return true;
      return [
        definition.label,
        definition.category,
        definition.scope,
        definition.upstreamAction ?? '',
        currentLabel ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [assignedOnly, resolution, search]);

  const groupedRows = useMemo(() => {
    return rows.reduce<Record<string, typeof rows>>((groups, row) => {
      groups[row.category] = groups[row.category] ?? [];
      groups[row.category].push(row);
      return groups;
    }, {});
  }, [rows]);

  const resetAll = () => {
    void requestConfirmation({
      title: t('dialogs:settings.shortcuts.resetAllTitle', 'Reset Shortcuts'),
      message: t('dialogs:settings.shortcuts.resetAllMessage', 'Restore all keyboard shortcuts to their defaults?'),
      confirmLabel: t('dialogs:common.reset', 'Reset'),
      tone: 'danger',
    }).then((confirmed) => {
      if (!confirmed) return;
      resetAllShortcuts();
      setCapturingId(null);
      setFeedback(null);
    });
  };

  const changeDefaultsSource = (next: ShortcutDefaultsSource) => {
    setCapturingId(null);
    setFeedback(null);
    const diff = diffDefaultsSource(overrides, defaultsSource, next);
    // Which layout a user settles on is the one thing this feature exists to
    // learn; the chokepoint cannot see it, since the toggle is not a menu action.
    // An enum, and only after the switch actually happens.
    const commit = (source: ShortcutDefaultsSource) => {
      setDefaultsSource(source);
      track(ANALYTICS_EVENTS.shortcutDefaultsSourceChanged, { source });
    };
    // Nothing to warn about, so nothing to ask about.
    if (diff.changes.length === 0) {
      commit(next);
      return;
    }
    void requestConfirmation({
      title:
        next === 'oriedita'
          ? t('dialogs:settings.shortcuts.defaultsOrieditaTitle', 'Use Oriedita defaults?')
          : t('dialogs:settings.shortcuts.defaultsOriStudioTitle', 'Use Ori Studio defaults?'),
      message: defaultsSourceMessage(t, diff),
      confirmLabel:
        next === 'oriedita'
          ? t('dialogs:settings.shortcuts.defaultsOrieditaConfirm', 'Use Oriedita defaults')
          : t('dialogs:settings.shortcuts.defaultsOriStudioConfirm', 'Use Ori Studio defaults'),
    }).then((confirmed) => {
      if (!confirmed) return;
      commit(next);
    });
  };

  return (
    <div className="settings-tab settings-shortcuts">
      <section className="settings-section">
        {/*
          Above the toolbar, and shaped like a preference rather than a chip:
          it selects which table the whole list resolves against, so sitting it
          beside Search and Assigned would read as a third filter.
        */}
        <SettingsToggleRow
          label={t('dialogs:settings.shortcuts.useOrieditaDefaults', 'Use Oriedita defaults')}
          description={t(
            'dialogs:settings.shortcuts.useOrieditaDefaultsHint',
            "Oriedita's crease-pattern keys: M, V and L for line types, F to fold, R to mirror. Shortcuts you set yourself are left alone."
          )}
          checked={defaultsSource === 'oriedita'}
          onChange={(checked) => changeDefaultsSource(checked ? 'oriedita' : 'ori-studio')}
        />
      </section>

      <section className="settings-section">
        <div className="settings-shortcuts__toolbar">
          <input
            type="search"
            value={search}
            placeholder={t('dialogs:settings.shortcuts.search', 'Search shortcuts')}
            aria-label={t('dialogs:settings.shortcuts.search', 'Search shortcuts')}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="settings-shortcuts__filter">
            <input
              type="checkbox"
              checked={assignedOnly}
              onChange={(event) => setAssignedOnly(event.target.checked)}
            />
            {t('dialogs:settings.shortcuts.assigned', 'Assigned')}
          </label>
          <div className="settings-shortcuts__actions">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Download size={14} />
              {t('dialogs:settings.shortcuts.importOriedita', 'Import from Oriedita...')}
            </Button>
            {/*
              Icon-only, and last. It wipes every binding, yet it was the widest
              control here — competing with the two people actually reach for and
              pushing them onto a second line. Rare plus destructive is what an
              icon with a tooltip is for, and it still confirms before acting.
            */}
            <IconButton
              size="sm"
              title={t('dialogs:settings.shortcuts.resetAll', 'Reset All')}
              aria-label={t('dialogs:settings.shortcuts.resetAll', 'Reset All')}
              onClick={resetAll}
            >
              <RotateCcw size={14} />
            </IconButton>
          </div>
        </div>
      </section>

      {/*
        Mounted only while open so the dialog starts from a clean slate each
        time — it owns a multi-step flow (pick file, review plan, apply), and a
        cancelled run must not leave a stale plan behind the next one.
      */}
      {importing && <OrieditaImportDialog onClose={() => setImporting(false)} />}

      {Object.entries(groupedRows).map(([category, definitions]) => (
        <section key={category} className="settings-section">
          <h3 className="settings-section__title">{shortcutCategoryLabel(t, category)}</h3>
          <div className="settings-shortcuts__table">
            {definitions.map((definition) => {
              const currentLabel = shortcutLabelForAction(definition.id, resolution);
              const actionLabel = shortcutActionLabel(t, definition);
              // The active source's defaults, so the column and the reset button
              // beside it agree about what "default" means.
              const defaultChords = getDefaultShortcutChords(definition.id, defaultsSource);
              const defaultLabel =
                defaultChords.length > 0
                  ? defaultChords.map((chord) => formatKeyChord(chord)).join(' / ')
                  : '-';
              const hasOverride = Object.prototype.hasOwnProperty.call(
                overrides,
                definition.id
              );
              // A chord this host never delivers. The row printed it like any
              // other, so File ▸ New advertised Cmd+N in a browser that takes it
              // before the page — a shortcut that has never once fired there.
              const inert = getResolvedShortcuts(definition.id, resolution).find(
                (chord) => describeReservedKey(chord).classification === 'hard-reserved'
              );
              const inertMessage = inert
                ? reservedKeyMessage(t, inert, describeReservedKey(inert).reason)
                : null;
              return (
                <div key={definition.id} className="settings-shortcuts__row">
                  <div className="settings-shortcuts__copy">
                    <span>{actionLabel}</span>
                    <small>
                      {shortcutScopeLabel(t, definition.scope)}
                      {definition.upstreamAction ? ` - ${definition.upstreamAction}` : ''}
                      {inert
                        ? ` - ${t('dialogs:settings.shortcuts.inactiveHere', 'not active here')}`
                        : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="settings-shortcuts__capture"
                    data-capturing={capturingId === definition.id || undefined}
                    data-inert={inert ? true : undefined}
                    title={inertMessage ?? undefined}
                    onClick={() => {
                      setCapturingId(definition.id);
                      setFeedback(null);
                    }}
                    // Abandoning the recorder has to end the session, because an
                    // armed capture swallows every keystroke in the *whole app*
                    // — click "Press keys", change your mind, click anywhere
                    // else, and the keyboard is dead with nothing on screen
                    // saying why. Focus is the honest signal for "still
                    // recording": the button holds it for exactly as long as the
                    // session should last, and keys cannot move it because the
                    // handler consumes them.
                    onBlur={() => {
                      if (capturingId !== definition.id) return;
                      setCapturingId(null);
                      setFeedback(null);
                    }}
                  >
                    {capturingId === definition.id
                      ? t('dialogs:settings.shortcuts.pressKeys', 'Press keys')
                      : currentLabel
                        ? currentLabel
                        : t('dialogs:settings.shortcuts.unassigned', 'Unassigned')}
                  </button>
                  <span className="settings-shortcuts__default">
                    {defaultLabel}
                  </span>
                  <IconButton
                    size="sm"
                    title={t('dialogs:settings.shortcuts.clear', 'Clear {{label}} shortcut', { label: actionLabel })}
                    aria-label={t('dialogs:settings.shortcuts.clear', 'Clear {{label}} shortcut', { label: actionLabel })}
                    onClick={() => {
                      clearShortcut(definition.id);
                      setCapturingId(null);
                      setFeedback(null);
                    }}
                  >
                    <X size={13} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    title={t('dialogs:settings.shortcuts.reset', 'Reset {{label}} shortcut', { label: actionLabel })}
                    aria-label={t('dialogs:settings.shortcuts.reset', 'Reset {{label}} shortcut', { label: actionLabel })}
                    disabled={!hasOverride}
                    onClick={() => {
                      resetShortcut(definition.id);
                      setCapturingId(null);
                      setFeedback(null);
                    }}
                  >
                    <RotateCcw size={13} />
                  </IconButton>
                  {feedback?.actionId === definition.id && (
                    // `assertive`, not `polite`: this answers a key the user
                    // just pressed, and a polite region waits for a pause that
                    // someone trying chords in quick succession never gives.
                    <p className="settings-shortcuts__rowMessage" role="alert" aria-live="assertive">
                      {feedback.text}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const TAB_COMPONENTS: Record<SettingsTab, () => ReactElement> = {
  general: GeneralTab,
  appearance: AppearanceTab,
  shortcuts: ShortcutsTab,
  workspace: WorkspaceTab,
};

function SettingsModalContent({
  initialTab,
  closeSettings,
}: {
  initialTab: SettingsTab;
  closeSettings: () => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);
  const ActiveTab = TAB_COMPONENTS[activeTab];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A nested dialog owns Escape while it is open; see NestedDialogContext.
      if (nestedDialogOpen) return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeSettings, nestedDialogOpen]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogs:settings.title', 'Settings')}
      className="settings-modal"
      onMouseDown={closeSettings}
    >
      <div
        role="document"
        className="settings-modal__document"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="settings-modal__sidebar">
          <div className="settings-modal__title">{t('dialogs:settings.title', 'Settings')}</div>
          <nav className="settings-modal__tabs" aria-label={t('dialogs:settings.sections', 'Settings sections')}>
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className="settings-modal__tab"
                  data-active={activeTab === tab.key || undefined}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{tabLabel(t, tab.key)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="settings-modal__content">
          <header className="settings-modal__header">
            <h2>{tabLabel(t, activeTab)}</h2>
            <IconButton
              size="sm"
              aria-label={t('dialogs:settings.close', 'Close settings')}
              onClick={closeSettings}
            >
              <X size={15} />
            </IconButton>
          </header>
          <div className="settings-modal__body">
            <NestedDialogContext.Provider value={setNestedDialogOpen}>
              <ActiveTab />
            </NestedDialogContext.Provider>
          </div>
        </section>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const isOpen = useSettingsStore((state) => state.isSettingsOpen);
  const initialTab = useSettingsStore((state) => state.settingsInitialTab);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  if (!isOpen) return null;

  const resolvedInitialTab = resolveInitialTab(initialTab);
  return (
    <SettingsModalContent
      key={resolvedInitialTab}
      initialTab={resolvedInitialTab}
      closeSettings={closeSettings}
    />
  );
}
