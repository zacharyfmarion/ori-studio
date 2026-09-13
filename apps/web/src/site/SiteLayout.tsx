import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import './site.css';

/**
 * The frame every content page renders inside: masthead, the page, footer.
 *
 * Its own scroll container, for the reason `.welcome-page` is one: `body` is
 * `overflow: hidden` for the app, and a page of prose has to scroll somewhere.
 */
export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="site-page">
      <div className="site-page__scroll">
        <SiteHeader />
        <main className="site-main">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
