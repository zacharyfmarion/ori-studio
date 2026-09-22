import type { ReactNode } from 'react';

/**
 * The head of a content page: an eyebrow, the `<h1>`, a lead, and whatever sits under
 * them — the calls to action, usually.
 *
 * Presentation only, and the same reason `LandingSection` exists: four pages that each
 * bring their own heading markup are four slightly different heading sizes within a
 * month. The `<h1>` is the page's title in the current language, which on a localized
 * route is the string the prerender wrote into that file's `<title>`.
 */
export function SiteArticleHead({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <header className="site-article__head">
      <span className="site-eyebrow">{eyebrow}</span>
      <h1 className="site-title">{title}</h1>
      <p className="site-lead">{lead}</p>
      {children}
    </header>
  );
}

/** One titled section of a content page. `id` gives the heading a link target. */
export function SiteSection({
  id,
  title,
  children,
  wide = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? 'site-section site-section--wide' : 'site-section'} aria-labelledby={`${id}-title`}>
      <h2 className="site-heading" id={`${id}-title`}>
        {title}
      </h2>
      {children}
    </section>
  );
}
