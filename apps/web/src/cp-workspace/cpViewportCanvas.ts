/**
 * The class the crease-pattern drawing surface is rendered with, and the way to
 * find it from chrome that has no DOM path to it.
 *
 * The floating toolbars are portaled to `<body>` so they escape transformed
 * Dockview ancestors, which also cuts them off from the canvas they are hovering
 * over — {@link CanvasObjectOverlay} can reach it as a sibling, but they cannot.
 * A document-wide lookup is sound because there is exactly one: `layoutStore`
 * registers a single `crease-pattern` panel, and Dockview panel ids are unique.
 *
 * The class is exported rather than written twice so the render site and this
 * lookup cannot drift apart silently.
 */
export const CP_VIEWPORT_CANVAS_CLASS = 'cp-webgl-layer';

/** The live crease-pattern canvas, or null when no CP panel is mounted. */
export function resolveCpViewportCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>(`canvas.${CP_VIEWPORT_CANVAS_CLASS}`);
}
