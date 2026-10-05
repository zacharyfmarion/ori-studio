import styles from './ToolHintInstructions.module.css';

/**
 * How to use the tool in hand, as a tool window says it: a heading, a line on
 * what to do, and a list of the rest — Simulate's lines, Annotate's keys.
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
}: {
  heading: string;
  /** What to do, in a line or two, above the list. */
  intro?: string | null;
  /** One line each, as a bulleted list. */
  items?: readonly string[];
}) {
  return (
    <div className={styles.instructions}>
      <div className={styles.heading}>{heading}</div>
      {intro && <p className={styles.intro}>{intro}</p>}
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
