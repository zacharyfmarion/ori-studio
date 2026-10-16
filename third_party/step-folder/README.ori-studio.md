# DEFOX reference renderer

Unmodified source and resources from https://github.com/kei-morisue/step-folder
at 63e08215297f4edc5e4a50a7b12f3e2249f18d55 (MIT; see LICENSE).
Ori Studio consumes the drawing/conversion modules in a disposable worker through
`apps/web/src/diagram/import/defoxRenderer.js`. The browser GUI entry points are
not run. The SVG DOM adapter accepts only inert elements; all output passes the
existing SVG sanitizer before it enters a document.
