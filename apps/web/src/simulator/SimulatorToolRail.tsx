import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, Rotate3d } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { shortcutLabelForAction } from '../keyboard/shortcuts';
import { useShortcutStore } from '../store/shortcutStore';
import type { SimulatorToolButton } from './tools/actions';
import type { SimulatorToolIcon } from './tools/types';
import styles from './SimulatorToolRail.module.css';

const ICONS: Record<SimulatorToolIcon, typeof Pin> = {
  orbit: Rotate3d,
  pin: Pin,
};

/**
 * The Simulate canvas's tools, one icon wide, down its left edge — Edit's tool
 * rail in miniature, and the place later tools go.
 *
 * A vertical toolbar with one tab stop: the arrows move between tools, as the
 * ARIA toolbar pattern has it. The buttons are the app's `IconButton`, so a
 * long press names them on touch as every other icon control does.
 */
export function SimulatorToolRail({
  buttons,
  disabled,
}: {
  buttons: readonly SimulatorToolButton[];
  /** True until the simulation is ready: there is nothing to act on yet. */
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const overrides = useShortcutStore((store) => store.overrides);
  const defaultsSource = useShortcutStore((store) => store.defaultsSource);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // The tab stop sits on the tool in hand, so Tab lands where the user is.
  const focusIndex = Math.max(
    0,
    buttons.findIndex((button) => button.active)
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = refs.current.findIndex((button) => button === document.activeElement);
    if (current < 0) return;
    const last = buttons.length - 1;
    const next =
      event.key === 'ArrowDown'
        ? Math.min(last, current + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, current - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t('panels:simulator.tools.railLabel', 'Simulator tools')}
      className={styles.rail}
      onKeyDown={onKeyDown}
    >
      {buttons.map((button, index) => {
        const Icon = ICONS[button.icon];
        const key = shortcutLabelForAction(button.shortcut, { overrides, defaultsSource });
        const name = key ? `${button.label} (${key})` : button.label;
        return (
          <span key={button.id} className={styles.slot}>
            <IconButton
              ref={(element) => {
                refs.current[index] = element;
              }}
              variant="toolbar"
              isActive={button.active}
              aria-pressed={button.active}
              aria-label={button.label}
              title={`${name} - ${button.description}`}
              tooltipSide="right"
              tabIndex={index === focusIndex ? 0 : -1}
              disabled={disabled}
              data-tool={button.id}
              onClick={button.select}
            >
              <Icon size={16} aria-hidden="true" />
            </IconButton>
            {button.badge && <span className={styles.badge} data-tool-badge="" aria-hidden="true" />}
          </span>
        );
      })}
    </div>
  );
}
