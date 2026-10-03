import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import styles from './OptionCard.module.css';

export interface OptionCardOption<T extends string> {
  value: T;
  label: string;
  /** A line on what choosing it does. */
  description?: string;
  icon?: ReactNode;
  /** This option alone refuses the choice; it stays focusable, with its title saying why. */
  disabled?: boolean;
  title?: string;
}

interface OptionCardsProps<T extends string> {
  /** The group's accessible name. */
  label: string;
  value: T;
  options: readonly OptionCardOption<T>[];
  onChange: (value: T) => void;
  /** Every option refuses the choice; the group is still readable. */
  disabled?: boolean;
  /** Cards per row: 2 by default. */
  columns?: number;
}

/**
 * A choice among a few options, each a card with an icon, a name and a line
 * on what it does — Grid or Flow, PDF or step files. A radio group: one tab
 * stop on the chosen card, and the arrows move the choice, as they do in any
 * radio group.
 */
export function OptionCards<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  columns = 2,
}: OptionCardsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const refused = (index: number) => disabled || options[index]?.disabled === true;

  const choose = (index: number) => {
    const option = options[index];
    if (!option || refused(index)) return;
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    let next = -1;
    if (step !== 0) next = (index + step + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    if (next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
    choose(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={styles.group}
      style={{ '--option-columns': columns } as CSSProperties}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-disabled={refused(index) || undefined}
          tabIndex={index === chosen ? 0 : -1}
          title={option.title}
          className={styles.card}
          onClick={() => choose(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.icon && (
            <span className={styles.icon} aria-hidden="true">
              {option.icon}
            </span>
          )}
          <span className={styles.label}>{option.label}</span>
          {option.description && <span className={styles.description}>{option.description}</span>}
        </button>
      ))}
    </div>
  );
}
