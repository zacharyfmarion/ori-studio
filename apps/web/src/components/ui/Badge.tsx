import type { ReactNode } from 'react';

export type BadgeTone = 'accent' | 'neutral';

/**
 * A small inline label beside a title — "Beta" on a feature that is still
 * finding its limits. Text only, never interactive, and never the only place a
 * fact is stated: the sentence it flags belongs next to it.
 */
export function Badge({ tone = 'accent', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}
