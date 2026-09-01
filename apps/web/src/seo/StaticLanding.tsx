import type { CSSProperties } from 'react';
import { WelcomeLanding } from '../components/landing/WelcomeLanding';
import { SITE_TITLE } from './siteMeta';

/**
 * The standard accessible-hiding pattern, inline rather than as a global class.
 *
 * Inline because this is the only node in the app that needs it and the whole subtree is
 * removed before React mounts — a utility class in `index.css` would outlive its only
 * caller. Clip-based, never `display: none`: this is the form crawlers treat as ordinary
 * content and screen readers still announce.
 */
const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * The landing page as a crawler receives it.
 *
 * Deliberately thin: it renders {@link WelcomeLanding} — the *same* component the running
 * app renders — so the prerendered HTML and the React page cannot describe the product
 * differently. That is the whole reason this is a composition rather than a second copy of
 * the marketing copy, and it is the discipline `functions/_lib/cpShareHtml.ts` already
 * follows by importing `shareCardText` instead of restating it.
 *
 * The one thing it adds is an `<h1>`. Every landing section is an `<h2>`, and the only
 * `<h1>` in the app belongs to the start screen ("Start a new origami workspace") — a UI
 * heading for a control panel, not a description of the page. A document with no `<h1>`
 * leaves a crawler to guess what the page is about. It is hidden because the app's own
 * heading structure takes over the moment React mounts, and a heading that exists for two
 * hundred milliseconds should not push the layout around while it is there.
 */
export function StaticLanding() {
  return (
    <>
      <h1 style={visuallyHidden}>{SITE_TITLE}</h1>
      <WelcomeLanding />
    </>
  );
}
