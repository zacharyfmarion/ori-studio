/**
 * Prettier covers the JS/TS side of the repo: TypeScript, JSX, the Node tooling
 * scripts, CSS, HTML, YAML, and hand-authored JSON. Rust is formatted by
 * `cargo fmt` (rustfmt defaults, gated in the `native-oracle` CI job), which is
 * why there is no rustfmt.toml — the defaults are the config.
 *
 * `.prettierignore` says what is deliberately out of scope, and why.
 *
 * @type {import('prettier').Config}
 */
export default {
  // The codebase was already written to roughly this width: across apps/web/src
  // the 95th-percentile line is 83 characters and the 99th is 97. Prettier's
  // default 80 would rewrite ~19% of all lines and add a net 37,000 of them,
  // which is a reformat of the codebase rather than a formatter for it. 100
  // reflows the genuine outliers and leaves the house style intact.
  printWidth: 100,

  // Single quotes in TS (824 source files use them, 4 do not); double quotes in
  // JSX attributes, which is `jsxSingleQuote: false` and already universal here.
  singleQuote: true,

  // Everything else is Prettier's default, deliberately: semicolons, 2-space
  // indent, `trailingComma: 'all'`, `arrowParens: 'always'`, `bracketSpacing`,
  // and LF endings all match what the repo already does. Defaults left unstated
  // are defaults nobody has to reason about later.
};
