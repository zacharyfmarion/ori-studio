import { ArrowUpRight } from 'lucide-react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * A link that leaves the site, and says so.
 *
 * The footer sets GitHub beside Download in the same type, and nothing in a plain anchor
 * says one is a page here and the other is another site. The arrow is the convention for
 * that. Decorative to a screen reader — the destination is in the href — so `aria-hidden`.
 *
 * Only for links the reader will *read* at, not files they download: a `.dmg` link is an
 * action, and the arrow would say "you are leaving" about something that stays put.
 */
export function ExternalLink({
  children,
  className = '',
  rel = 'noreferrer',
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  return (
    <a className={`site-external-link ${className}`.trim()} rel={rel} {...props}>
      {children}
      <ArrowUpRight className="site-external-link__mark" size={12} aria-hidden="true" />
    </a>
  );
}
