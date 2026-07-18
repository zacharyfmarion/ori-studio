import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Keyboard, LayoutDashboard, Palette, RotateCcw, X } from 'lucide-react';
import { SUPPORTED_LOCALES } from '../i18n/locales';
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

const TABS: Array<{ key: SettingsTab; label: string; icon: typeof Palette }> = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { key: 'workspace', label: 'Workspace', icon: LayoutDashboard },
];

const TAB_TITLES: Record<SettingsTab, string> = {
  appearance: 'Appearance',
  shortcuts: 'Shortcuts',
  workspace: 'Workspace',
};

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
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{t('dialogs:settings.language.title', 'Language')}</h3>
      <Select value={locale} onValueChange={setLocale}>
        <SelectTrigger className="settings-full-width" aria-label={t('dialogs:settings.language.title', 'Language')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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
      { key: 'dark', label: 'Dark', themes: grouped.dark },
      { key: 'light', label: 'Light', themes: grouped.light },
    ].filter((section) => section.themes.length > 0);
  }, [presetThemes]);

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
  const resetLayout = useLayoutStore((state) => state.resetLayout);

  return (
    <div className="settings-tab">
      <section className="settings-section">
        <h3 className="settings-section__title">Layout</h3>
        <Button
          size="md"
          variant="secondary"
          className="settings-full-width"
          onClick={() => {
            void requestConfirmation({
              title: 'Reset Workspace Layout',
              message: 'Restore the default layout for the current workspace?',
              confirmLabel: 'Reset',
              tone: 'danger',
            }).then((confirmed) => {
              if (!confirmed) return;
              resetLayout();
            });
          }}
        >
          <RotateCcw size={14} />
          Reset Workspace Layout
        </Button>
      </section>
    </div>
  );
}

function ShortcutsTab() {
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
        setMessage(`${formatKeyChord(chord)} is reserved by the browser.`);
        return;
      }
      const conflict = findShortcutConflict(capturingId, chord, overrides);
      if (conflict) {
        setMessage(`${formatKeyChord(chord)} is already assigned to ${conflict.label}.`);
        return;
      }
      setShortcut(capturingId, chord);
      setCapturingId(null);
      setMessage(
        reserved === 'soft-reserved'
          ? `${formatKeyChord(chord)} was assigned, but some browsers may reserve it.`
          : null
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturingId, overrides, setShortcut]);

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
      title: 'Reset Shortcuts',
      message: 'Restore all keyboard shortcuts to their defaults?',
      confirmLabel: 'Reset',
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
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="settings-shortcuts__assigned">
            <input
              type="checkbox"
              checked={assignedOnly}
              onChange={(event) => setAssignedOnly(event.target.checked)}
            />
            Assigned
          </label>
          <Button size="sm" variant="secondary" onClick={resetAll}>
            <RotateCcw size={14} />
            Reset All
          </Button>
        </div>
        {message && <div className="settings-shortcuts__message">{message}</div>}
      </section>

      {Object.entries(groupedRows).map(([category, definitions]) => (
        <section key={category} className="settings-section">
          <h3 className="settings-section__title">{category}</h3>
          <div className="settings-shortcuts__table">
            {definitions.map((definition) => {
              const currentLabel = shortcutLabelForAction(definition.id, overrides);
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
                    <span>{definition.label}</span>
                    <small>
                      {definition.scope}
                      {definition.upstreamAction ? ` - ${definition.upstreamAction}` : ''}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="settings-shortcuts__capture"
                    data-capturing={capturingId === definition.id || undefined}
                    onClick={() => {
                      setCapturingId(definition.id);
                      setMessage(`Press a shortcut for ${definition.label}.`);
                    }}
                  >
                    {capturingId === definition.id
                      ? 'Press keys'
                      : currentLabel
                        ? currentLabel
                        : 'Unassigned'}
                  </button>
                  <span className="settings-shortcuts__default">
                    {defaultLabel}
                  </span>
                  <IconButton
                    size="sm"
                    title={`Clear ${definition.label} shortcut`}
                    aria-label={`Clear ${definition.label} shortcut`}
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
                    title={`Reset ${definition.label} shortcut`}
                    aria-label={`Reset ${definition.label} shortcut`}
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
      aria-label="Settings"
      className="settings-modal"
      onMouseDown={closeSettings}
    >
      <div
        role="document"
        className="settings-modal__document"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="settings-modal__sidebar">
          <div className="settings-modal__title">Settings</div>
          <nav className="settings-modal__tabs" aria-label="Settings sections">
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
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="settings-modal__content">
          <header className="settings-modal__header">
            <h2>{TAB_TITLES[activeTab]}</h2>
            <IconButton
              size="sm"
              aria-label="Close settings"
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
