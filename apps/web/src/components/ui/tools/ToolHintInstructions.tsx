import styles from './ToolHintInstructions.module.css';

/** Where a numbered step stands against the one in hand. */
type StepProgress = 'done' | 'current' | 'todo';

function stepProgress(index: number, current: number): StepProgress {
  if (index < current) return 'done';
  return index === current ? 'current' : 'todo';
}

/**
 * Progress belongs to steps taken in order, so `current` is only accepted with
 * `ordered`, and a bulleted list never shows any: there it would have nothing
 * to say.
 */
type ListShape =
  | {
      ordered?: false;
      current?: never;
    }
  | {
      /** The items are steps taken in order, as a numbered list. */
      ordered: true;
      /**
       * The index of the step in hand. The steps before it read as done, it is
       * highlighted, and the rest are still to do; past the last step, every
       * step is done. Without it the list is numbered and shows no progress.
       */
      current?: number;
    };

/**
 * How to use the tool in hand, as a tool window says it: a heading, a line on
 * what to do, and a list of the rest — Simulate's lines, Annotate's keys, or a
 * tool's numbered steps with the one in hand marked.
 *
 * The window (`ToolHintWindow`) is shared, and so is this, its commonest
 * content: workspaces that each wrote the same heading and list would drift
 * apart, and the windows are meant to read as one window wherever it opens.
 * What a workspace says stays its own; this only lays it out.
 */
export function ToolHintInstructions({
  heading,
  intro,
  items = [],
  ordered = false,
  current,
}: {
  heading: string;
  /** What to do, in a line or two, above the list. */
  intro?: string | null;
  /** One line each, as a bulleted list, or as numbered steps when `ordered`. */
  items?: readonly string[];
} & ListShape) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <div className={styles.instructions}>
      <div className={styles.heading}>{heading}</div>
      {intro && <p className={styles.intro}>{intro}</p>}
      {items.length > 0 && (
        <List className={styles.list} data-ordered={ordered || undefined}>
          {items.map((line, index) => {
            const progress = ordered && current !== undefined ? stepProgress(index, current) : undefined;
            // A step is its place in the sequence, and two steps may say the
            // same thing; a bullet is its line.
            return (
              <li
                key={ordered ? index : line}
                data-progress={progress}
                aria-current={progress === 'current' ? 'step' : undefined}
              >
                {line}
              </li>
            );
          })}
        </List>
      )}
    </div>
  );
}
