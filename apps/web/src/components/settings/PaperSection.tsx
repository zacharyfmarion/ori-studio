import type { ReactNode } from 'react';

/**
 * One group of paper fields: an uppercase eyebrow, an optional line naming the
 * surfaces the group reaches, then the fields themselves.
 *
 * Paper-scoped rather than the `.settings-section` every other tab uses: this
 * tab boxes its fields into cards under the eyebrow, and the flat sections the
 * rest of Settings is built from should stay flat.
 */
export function PaperSection({
  title,
  hint,
  testId,
  children,
}: {
  title: string;
  /** Which surfaces the group covers, beside the eyebrow. Omit where there is nothing to name. */
  hint?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-paper__section" data-testid={testId}>
      <div className="settings-paper__heading">
        <h3 className="settings-paper__eyebrow">{title}</h3>
        {hint !== undefined && <span className="settings-paper__hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
