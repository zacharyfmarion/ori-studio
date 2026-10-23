import { forwardRef, type MouseEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from '../Badge';
import styles from './StepCard.module.css';

export interface StepCardProps {
  /** The entry's id, on the card as `data-step-id`: what a drop, a menu and a test find it by. */
  id: string;
  selected: boolean;
  /** Whether this card is the grid's tab stop. */
  tabStop: boolean;
  /**
   * Its place among the grid's entries, 1-based, and how many there are: what
   * a screen reader says of an option while the grid mounts only the rows in
   * view. Absent, the listbox's mounted options are all there are.
   */
  position?: number;
  total?: number;
  /** Something dragged over the grid would land on this card. */
  dropTarget?: boolean;
  /** The card's accessible name, when it is not named by its parts (`labelledBy`). */
  label?: string;
  /** The ids of the parts the card is named by, in the order they are read. */
  labelledBy?: string;
  /** More of the card's own data attributes: what it is, for a test or a stylesheet of the surface's. */
  attributes?: Readonly<Record<`data-${string}`, string | undefined>>;
  /** The header's lead: a step's number, or a turn's name. */
  title: ReactNode;
  titleId?: string;
  /** Beside the title, at the header's end: the kind's badge (`StepCardBadge`), and what the surface puts by it. */
  kind: ReactNode;
  /** The well shows the paper it prints on, white in either theme, rather than the theme's ground. */
  paper: boolean;
  /** The well: a picture, a glyph, or a placeholder (`StepCardPlaceholder`). */
  children: ReactNode;
  /** Pointer shortcuts over the well's corner (`StepCardVerb`); absent where the sequence cannot change. */
  verbs?: ReactNode;
  /** Anything else over the well, after its verbs, placed by the surface: a link's state, a capture's progress. */
  overlay?: ReactNode;
  /** The instruction under the well. */
  instruction: ReactNode;
  instructionId?: string;
  /** The instruction is a stand-in for none, shown quieter. */
  instructionEmpty?: boolean;
  onSelect: (id: string) => void;
  /** Open the entry in detail, from a double-click; absent for one with no detail. */
  onOpen?: (id: string) => void;
}

/**
 * One entry in a Steps grid (`StepsGrid`): a header with its number — or a
 * turn's name — and its kind, a square well holding its picture, and its
 * instruction under it. What goes in each is the surface's: a Diagram step's
 * picture and the ways to give it one, a turn's glyph (`TurnCard`).
 *
 * An `option` of the grid's listbox rather than a button: the grid is one
 * control, navigated with the arrows, and a screen reader announces it as a
 * list to choose from rather than a row of unrelated buttons. The grid moves
 * focus between cards as the selection moves (a roving tab stop), which is
 * what lets a screen reader follow it. The card is named from its parts, or by
 * a label of its own — never from the pointer shortcuts over its well, which
 * are hidden from assistive technology.
 */
export const StepCard = forwardRef<HTMLDivElement, StepCardProps>(function StepCard(
  {
    id,
    selected,
    tabStop,
    position,
    total,
    dropTarget = false,
    label,
    labelledBy,
    attributes,
    title,
    titleId,
    kind,
    paper,
    children,
    verbs,
    overlay,
    instruction,
    instructionId,
    instructionEmpty = false,
    onSelect,
    onOpen,
  },
  ref
) {
  return (
    <div
      ref={ref}
      role="option"
      aria-posinset={position}
      aria-setsize={total}
      aria-selected={selected}
      aria-label={label}
      tabIndex={tabStop ? 0 : -1}
      aria-labelledby={labelledBy}
      className={styles.card}
      data-selected={selected || undefined}
      data-drop-target={dropTarget || undefined}
      data-step-id={id}
      {...attributes}
      onClick={() => onSelect(id)}
      onDoubleClick={onOpen && (() => onOpen(id))}
    >
      <div className={styles.header}>
        <span id={titleId} className={styles.number}>
          {title}
        </span>
        <span className={styles.kind}>{kind}</span>
      </div>
      <div className={styles.well} data-picture={paper || undefined}>
        {children}
        {verbs ? <span className={styles.verbs}>{verbs}</span> : null}
        {overlay}
      </div>
      <p id={instructionId} className={styles.instruction} data-empty={instructionEmpty || undefined}>
        {instruction}
      </p>
    </div>
  );
});

/** The card's kind, a badge in its header: on one line, so whatever stands beside it gives way, not it. */
export function StepCardBadge({ id, children }: { id?: string; children: ReactNode }) {
  // Wrapped, so every card's header is one height, whatever its badge says.
  return (
    <span id={id} className={styles.kindBadge}>
      <Badge tone="neutral">{children}</Badge>
    </span>
  );
}

/** What the well says when it has no picture to show, and the ways to give it one. */
export function StepCardPlaceholder({ children }: { children: ReactNode }) {
  return <span className={styles.placeholder}>{children}</span>;
}

/**
 * A pointer's shortcut over the well's corner — Adjust pose, Annotate, Delete:
 * hidden from assistive technology and out of the tab order, the card's menu
 * and the surface's pane being the keyboard's way to the same verb. A press
 * takes no focus from the card's keys, and neither selects the card nor, as
 * part of a double-click, opens it.
 */
export function StepCardVerb({
  label,
  danger = false,
  onPress,
  children,
}: {
  label: string;
  /** It takes something away: it turns the danger colour under the pointer. */
  danger?: boolean;
  onPress: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.verb}
      data-danger={danger ? '' : undefined}
      title={label}
      tabIndex={-1}
      aria-hidden="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onPress(event);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}

/** A card's Delete, over its well's corner: the card's menu, the surface's pane and the Delete key are the keyboard's. */
export function StepCardDeleteVerb({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <StepCardVerb
      label={label}
      danger
      onPress={(event) => {
        // The second click of a double-click lands on whatever card took this
        // one's place, which it must not delete too.
        if (event.detail > 1) return;
        onDelete();
      }}
    >
      <Trash2 size={14} />
    </StepCardVerb>
  );
}
