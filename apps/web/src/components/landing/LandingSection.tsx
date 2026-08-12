import type { ReactNode } from 'react';

export interface LandingSectionProps {
  /** DOM id, so the section can be linked to and observed by name. */
  id: string;
  eyebrow: string;
  title: string;
  /** Optional lead paragraph, set above the section's body. */
  lead?: string;
  /** Alternating background, so consecutive sections read as separate bands. */
  tone?: 'plain' | 'raised';
  children?: ReactNode;
}

/**
 * One band of the landing page: an eyebrow, a heading, an optional lead, and
 * whatever the section is actually showing.
 *
 * Presentation only. It exists so the four sections cannot drift into four
 * slightly different heading sizes, which is what happens when each one brings
 * its own markup.
 */
export function LandingSection({
  id,
  eyebrow,
  title,
  lead,
  tone = 'plain',
  children,
}: LandingSectionProps) {
  return (
    <section className="landing-section" id={id} data-tone={tone} aria-labelledby={`${id}-title`}>
      <div className="landing-section__inner">
        <header className="landing-section__head">
          <span className="landing-section__eyebrow">{eyebrow}</span>
          <h2 className="landing-section__title" id={`${id}-title`}>
            {title}
          </h2>
          {lead ? <p className="landing-section__lead">{lead}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}
