/**
 * Cloudflare Pages' `_headers` file, read the way Pages reads it, for the local stand-ins
 * that check the service worker (`webkit-pwa-check.mjs`, `sw-fallback-check.mjs`).
 *
 * Parsed rather than hardcoded on purpose: COOP/COEP and the `/assets/` cache headers live
 * in `apps/web/public/_headers`, and hardcoding them in a check would leave the one test
 * that can catch their removal passing after they were removed.
 */

/** The rules in a `_headers` file: a path pattern, and the headers it sets. */
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1 || !current) continue;
    current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

/**
 * The headers `_headers` sets on `pathname`. By path alone, as on Pages, so the SPA
 * fallback for a missing `/assets/` file gets the `/assets/*` headers too.
 */
export function headersFor(rules, pathname) {
  const out = {};
  for (const rule of rules) {
    const re = new RegExp(`^${rule.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    if (re.test(pathname)) for (const [key, value] of rule.headers) out[key] = value;
  }
  return out;
}
