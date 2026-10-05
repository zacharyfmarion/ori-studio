/**
 * Ids in a picture's markup renamed, so two copies of one picture never share
 * one: two page cells drawn from one asset, or a picture and the close-up
 * that draws it again (15f).
 *
 * Pure: no DOM.
 */

/**
 * Every id a fragment declares or refers to, renamed under `prefix`: in
 * `id="…"`, `href="#…"` (and `xlink:href`) and `url(#…)`, inside tags only, so
 * no text a picture draws is touched. Our painters and the sanitizer write
 * references in no other form.
 */
export function prefixIds(markup: string, prefix: string): string {
  return markup.replace(/<[^>]*>/g, (tag) =>
    tag
      .replace(/(\sid=")([^"]*)"/g, (_, head: string, id: string) => `${head}${prefix}${id}"`)
      .replace(/(href=")#([^"]*)"/g, (_, head: string, id: string) => `${head}#${prefix}${id}"`)
      .replace(/url\(\s*(['"]?)#([^)'"]*)\1\s*\)/g, (_, quote: string, id: string) => `url(${quote}#${prefix}${id}${quote})`)
  );
}
