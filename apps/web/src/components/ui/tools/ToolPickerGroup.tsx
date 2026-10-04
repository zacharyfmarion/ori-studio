/**
 * A titled section of the phone tool sheet, and the list and note that go in
 * one. Separate pieces because not every section is a list: Edit's line types
 * are a segmented control under their heading, while its tool groups and its
 * favorites are lists of rows.
 */
import type { ReactNode } from 'react';
import styles from './ToolPickerGroup.module.css';

export function ToolPickerGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-tool-group="">
      <h3 className={styles.title}>{title}</h3>
      {children}
    </section>
  );
}

/** The rows of a section (`ToolPickerRow`s). */
export function ToolPickerList({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

/** A line of explanation under a section's heading. */
export function ToolPickerNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
