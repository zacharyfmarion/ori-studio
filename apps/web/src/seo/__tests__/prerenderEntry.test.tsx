import { describe, expect, it } from 'vitest';
import { LANDING_SECTIONS } from '../../components/landing/WelcomeLanding';
import { escapeForScriptTag, landingJsonLd, landingJsonLdScript } from '../jsonLd';
import { renderLandingMarkup } from '../prerenderEntry';
import { SEO_CONTENT_ID, SITE_ORIGIN, SITE_TITLE, SITEMAP_PATHS } from '../siteMeta';

/**
 * The PR-time gate on the prerender.
 *
 * CI never builds a `dist` — the web-client job lints, typechecks and tests — so nothing
 * else here would notice the prerender throwing or quietly rendering an empty string. The
 * post-deploy smoke test would, but only once it had shipped. This runs on every PR.
 */
describe('landing prerender', () => {
  const markup = renderLandingMarkup();

  it('renders the landing copy a crawler needs to see', () => {
    // The pitch, in the words the plan targets. If the marketing copy is rewritten these
    // should be updated deliberately — that is the point of asserting on them.
    expect(markup).toContain('crease pattern');
    expect(markup).toContain('open-source');
    expect(markup).toContain('Box Pleating');
    expect(markup).toContain('Circle Packing');
  });

  it('renders every landing section, not just the one above the fold', () => {
    // Both carousels map over all their items rather than mounting only the active one,
    // which is what puts every feature's text in the static HTML. A carousel rewritten to
    // render lazily would silently cut the indexable copy down to the first slide.
    for (const section of LANDING_SECTIONS) {
      expect(markup).toContain(`id="${section.id}"`);
    }
  });

  it('gives the document exactly one h1, naming what the page is', () => {
    const h1s = markup.match(/<h1[\s>]/g) ?? [];
    expect(h1s).toHaveLength(1);
    expect(markup).toContain(SITE_TITLE);
  });

  it('hides that h1 by clipping, never by display:none', () => {
    // `display: none` is the form crawlers discount. Clip-based hiding is ordinary
    // content to them and is still announced by screen readers.
    expect(markup).toContain('clip-path:inset(50%)');
    expect(markup).not.toMatch(/<h1[^>]*display:\s*none/);
  });

  it('produces static markup with no hydration payload', () => {
    // `renderToStaticMarkup`, not `renderToString`: nothing hydrates this, so React's
    // hydration markers would be bytes shipped to every visitor for no reason.
    expect(markup).not.toContain('data-reactroot');
    expect(markup).not.toContain('<!--$-->');
  });
});

describe('site metadata', () => {
  it('keeps the id the prerender writes and main.tsx removes in one place', () => {
    // A drift here is the silent failure: the app would boot with the crawler copy still
    // on the page, underneath the real one.
    expect(SEO_CONTENT_ID).toBe('seo-content');
  });

  it('builds absolute sitemap URLs on the canonical origin', () => {
    expect(SITE_ORIGIN).not.toMatch(/\/$/);
    expect(SITEMAP_PATHS).toContain('/');
  });
});

describe('landing JSON-LD', () => {
  const data = landingJsonLd();

  it('declares a free SoftwareApplication Google can resolve to an entity', () => {
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.isAccessibleForFree).toBe(true);
    expect(data.offers).toMatchObject({ price: '0' });
  });

  it('links the entity to the repository and chat', () => {
    // `sameAs` is what ties this page to the GitHub project Google already indexes —
    // the strongest available disambiguation from the two design studios of the same name.
    expect(data.sameAs).toEqual(
      expect.arrayContaining([expect.stringContaining('github.com')])
    );
  });

  it('escapes < so a value can never close the script tag', () => {
    // Against a hostile string, because none of the live constants contains a `<` — so
    // asserting on the real output passes whether or not the escaper is wired up at all.
    // That was the previous version of this test, and it tested nothing.
    expect(escapeForScriptTag('{"x":"</script><img onerror=1>"}')).not.toContain('</script');
    expect(escapeForScriptTag('{"x":"</script>"}')).toContain('\\u003c/script');
    // And the shipped block carries no raw `<` either way.
    expect(landingJsonLdScript()).not.toContain('<');
  });
});
