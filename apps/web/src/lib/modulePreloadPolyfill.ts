/**
 * `<link rel="modulepreload">` for a browser without it (Safari before 17,
 * Firefox before 115): Vite's polyfill, with its fetch's failure handled.
 *
 * Vite adds a preload link for each chunk a lazy import needs, so the browser
 * fetches them side by side rather than one after another. Where the browser
 * ignores those links, Vite's polyfill fetches each one itself and drops the
 * answer, and with it the failure: on a connection that dropped, every preload
 * that failed was an unhandled rejection, reported to Sentry from inside Vite's
 * helper (ORI-STUDIO-N). A preload is only a head start: the import that needs
 * the chunk asks for it again and handles its own failure, so a preload that
 * failed is dropped here. `vite.config.ts` turns Vite's polyfill off
 * (`build.modulePreload.polyfill`) for this one.
 *
 * Imported first from `main.tsx`, through `polyfills.ts`, as Vite's ran first
 * in the entry chunk.
 */

type PreloadLink = Pick<HTMLLinkElement, 'href' | 'integrity' | 'referrerPolicy' | 'crossOrigin'>;

export interface ModulePreloadEnvironment {
  /** Whether the browser preloads modules itself, in which case nothing is installed. */
  supported: boolean;
  /** The preload links already in the document. */
  links: () => Iterable<PreloadLink>;
  /** Call `onLink` for every preload link added to the document from now on. */
  observe: (onLink: (link: PreloadLink) => void) => void;
  fetch: (url: string, init: RequestInit) => Promise<unknown>;
}

function isPreloadLink(node: Node): node is HTMLLinkElement {
  return (node as Element).tagName === 'LINK' && (node as HTMLLinkElement).rel === 'modulepreload';
}

/** Whether links preload modules here; `supports` throws where `rel` names no supported tokens. */
function supportsModulePreload(): boolean {
  try {
    const relList = document.createElement('link').relList as DOMTokenList | undefined;
    return Boolean(relList?.supports?.('modulepreload'));
  } catch {
    return false;
  }
}

function browserEnvironment(): ModulePreloadEnvironment | null {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return null;
  return {
    supported: supportsModulePreload(),
    links: () => document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'),
    observe: (onLink) =>
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== 'childList') continue;
          for (const node of mutation.addedNodes) if (isPreloadLink(node)) onLink(node);
        }
      }).observe(document, { childList: true, subtree: true }),
    fetch: (url, init) => fetch(url, init),
  };
}

/** The credentials, integrity and referrer policy the link asks for, as Vite's polyfill reads them. */
function fetchOptions(link: PreloadLink): RequestInit {
  const init: RequestInit = {};
  if (link.integrity) init.integrity = link.integrity;
  if (link.referrerPolicy) init.referrerPolicy = link.referrerPolicy as ReferrerPolicy;
  init.credentials =
    link.crossOrigin === 'use-credentials' ? 'include' : link.crossOrigin === 'anonymous' ? 'omit' : 'same-origin';
  return init;
}

/** Fetch every preload link once, now and as links are added; nothing where the browser does it itself. */
export function installModulePreloadPolyfill(
  environment: ModulePreloadEnvironment | null = browserEnvironment()
): void {
  if (!environment || environment.supported) return;
  const fetched = new WeakSet<PreloadLink>();
  const preload = (link: PreloadLink) => {
    if (fetched.has(link)) return;
    fetched.add(link);
    // A head start only: the import that needs the chunk fetches it again and handles a failure.
    environment.fetch(link.href, fetchOptions(link)).catch(() => undefined);
  };
  for (const link of environment.links()) preload(link);
  environment.observe(preload);
}
