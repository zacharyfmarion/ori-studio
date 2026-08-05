import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Check, Keyboard, LayoutDashboard, Palette, RotateCcw, X } from 'lucide-react';
import { useAnalytics } from '../analytics';
import { detectSystemLocale, SUPPORTED_LOCALES, SYSTEM_LOCALE } from '../i18n/locales';
import {
  shortcutActionLabel,
  shortcutCategoryLabel,
  shortcutScopeLabel,
} from '../i18n/shortcutLabels';
import { useLocaleStore } from '../store/localeStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import {
  classifyReservedKey,
  findShortcutConflict,
  formatKeyChord,
  keyChordFromKeyboardEvent,
  SHORTCUT_DEFINITIONS,
  shortcutLabelForAction,
  type ShortcutActionId,
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
  { key: 'appearance', icon: Palette },
  { key: 'shortcuts', icon: Keyboard },
  { key: 'workspace', icon: LayoutDashboard },
];

/** Localized tab label. Literal `t()` calls keep the keys extractable. */
function tabLabel(t: TFunction, key: SettingsTab): string {
  switch (key) {
    case 'appearance':
      return t('dialogs:settings.tab.appearance', 'Appearance');
    case 'shortcuts':
      return t('dialogs:settings.tab.shortcuts', 'Shortcuts');
    case 'workspace':
      return t('dialogs:settings.tab.workspace', 'Workspace');
  }
}

function resolveInitialTab(initialTab: SettingsTab | null): SettingsTab {
  return initialTab && TABS.some((tab) => tab.key === initialTab) ? initialTab : 'appearance';
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

function WorkspaceTab() {
  const { t } = useTranslation();
  const resetLayout = useLayoutStore((state) => state.resetLayout);
  const showWelcomeOnStartup = useSettingsStore((state) => state.showWelcomeOnStartup);
  const setShowWelcomeOnStartup = useSettingsStore((state) => state.setShowWelcomeOnStartup);
  const foldWarningEnabled = useSettingsStore((state) => state.foldWarningEnabled);
  const setFoldWarningEnabled = useSettingsStore((state) => state.setFoldWarningEnabled);
  const analyticsEnabled = useSettingsStore((state) => state.analyticsEnabled);
  const setAnalyticsEnabled = useSettingsStore((state) => state.setAnalyticsEnabled);
  const analytics = useAnalytics();

  return (
    <div className="settings-tab">
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.workspace.startup', 'Startup')}
        </h3>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={showWelcomeOnStartup}
            onChange={(event) => setShowWelcomeOnStartup(event.target.checked)}
          />
          {t('dialogs:settings.workspace.showWelcome', 'Show welcome screen on startup')}
        </label>
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.workspace.folding', 'Folding')}
        </h3>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={foldWarningEnabled}
            onChange={(event) => setFoldWarningEnabled(event.target.checked)}
          />
          {t(
            'dialogs:settings.workspace.foldWarning',
            'Warn before folding a crease pattern with flat-foldability errors'
          )}
        </label>
      </section>
      <section className="settings-section">
        <h3 className="settings-section__title">
          {t('dialogs:settings.workspace.privacy', 'Privacy')}
        </h3>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={analyticsEnabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              // Persist the preference, then apply it to the analytics client:
              // opt in/out, (re)identify or reset, and record the change itself.
              setAnalyticsEnabled(enabled);
              analytics.setAnalyticsEnabled(enabled, { capturePreferenceChange: true });
            }}
          />
          {t(
            'dialogs:settings.workspace.analytics',
            'Send anonymous usage analytics to help improve Ori Studio'
          )}
        </label>
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

function ShortcutsTab() {
  const { t } = useTranslation();
  const overrides = useShortcutStore((state) => state.overrides);
  const setShortcut = useShortcutStore((state) => state.setShortcut);
  const clearShortcut = useShortcutStore((state) => state.clearShortcut);
  const resetShortcut = useShortcutStore((state) => state.resetShortcut);
  const resetAllShortcuts = useShortcutStore((state) => state.resetAllShortcuts);
  const [search, setSearch] = useState('');
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [capturingId, setCapturingId] = useState<ShortcutActionId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!capturingId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setCapturingId(null);
        setMessage(null);
        return;
      }
      const chord = keyChordFromKeyboardEvent(event);
      if (!chord) return;
      const reserved = classifyReservedKey(chord);
      if (reserved === 'hard-reserved') {
        setMessage(t('dialogs:settings.shortcuts.reserved', '{{chord}} is reserved by the browser.', { chord: formatKeyChord(chord) }));
        return;
      }
      const conflict = findShortcutConflict(capturingId, chord, overrides);
      if (conflict) {
        setMessage(t('dialogs:settings.shortcuts.alreadyAssigned', '{{chord}} is already assigned to {{label}}.', { chord: formatKeyChord(chord), label: conflict.label }));
        return;
      }
      setShortcut(capturingId, chord);
      setCapturingId(null);
      setMessage(
        reserved === 'soft-reserved'
          ? t('dialogs:settings.shortcuts.softReserved', '{{chord}} was assigned, but some browsers may reserve it.', { chord: formatKeyChord(chord) })
          : null
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturingId, overrides, setShortcut, t]);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return SHORTCUT_DEFINITIONS.filter((definition) => {
      const currentLabel = shortcutLabelForAction(definition.id, overrides);
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
  }, [assignedOnly, overrides, search]);

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
      setMessage(null);
    });
  };

  return (
    <div className="settings-tab settings-shortcuts">
      <section className="settings-section">
        <div className="settings-shortcuts__toolbar">
          <input
            type="search"
            value={search}
            placeholder={t('dialogs:settings.shortcuts.search', 'Search shortcuts')}
            aria-label={t('dialogs:settings.shortcuts.search', 'Search shortcuts')}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="settings-shortcuts__assigned">
            <input
              type="checkbox"
              checked={assignedOnly}
              onChange={(event) => setAssignedOnly(event.target.checked)}
            />
            {t('dialogs:settings.shortcuts.assigned', 'Assigned')}
          </label>
          <Button size="sm" variant="secondary" onClick={resetAll}>
            <RotateCcw size={14} />
            {t('dialogs:settings.shortcuts.resetAll', 'Reset All')}
          </Button>
        </div>
        {message && <div className="settings-shortcuts__message">{message}</div>}
      </section>

      {Object.entries(groupedRows).map(([category, definitions]) => (
        <section key={category} className="settings-section">
          <h3 className="settings-section__title">{shortcutCategoryLabel(t, category)}</h3>
          <div className="settings-shortcuts__table">
            {definitions.map((definition) => {
              const currentLabel = shortcutLabelForAction(definition.id, overrides);
              const actionLabel = shortcutActionLabel(t, definition);
              const defaultLabel =
                definition.defaultChords.length > 0
                  ? definition.defaultChords.map((chord) => formatKeyChord(chord)).join(' / ')
                  : '-';
              const hasOverride = Object.prototype.hasOwnProperty.call(
                overrides,
                definition.id
              );
              return (
                <div key={definition.id} className="settings-shortcuts__row">
                  <div className="settings-shortcuts__copy">
                    <span>{actionLabel}</span>
                    <small>
                      {shortcutScopeLabel(t, definition.scope)}
                      {definition.upstreamAction ? ` - ${definition.upstreamAction}` : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="settings-shortcuts__capture"
                    data-capturing={capturingId === definition.id || undefined}
                    onClick={() => {
                      setCapturingId(definition.id);
                      setMessage(t('dialogs:settings.shortcuts.pressPrompt', 'Press a shortcut for {{label}}.', { label: actionLabel }));
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
                      setMessage(null);
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
                      setMessage(null);
                    }}
                  >
                    <RotateCcw size={13} />
                  </IconButton>
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
  const ActiveTab = TAB_COMPONENTS[activeTab];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeSettings]);

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
            <ActiveTab />
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
