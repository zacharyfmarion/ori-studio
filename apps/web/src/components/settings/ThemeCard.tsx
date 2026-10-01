import { Check } from 'lucide-react';
import type { TreeMakerTheme } from '../../themes';
import styles from './ThemeCard.module.css';

/** A theme in Settings › Appearance: its name, and six swatches of its palette. */
export function ThemeCard({
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
      className={styles.card}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.header}>
        <span className={styles.name}>{theme.name}</span>
        {selected && <Check size={14} aria-hidden="true" />}
      </span>
      <span className={styles.swatches} aria-hidden="true">
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
