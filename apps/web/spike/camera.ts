// THROWAWAY Phase 0 spike — 2D world camera (pan / zoom-to-cursor).
// Screen convention: origin top-left, +y down (matches canvas & the app).

export interface Camera {
  centerX: number; // world coords at viewport center
  centerY: number;
  zoom: number; // device pixels per world unit
}

export interface Viewport {
  width: number; // device px
  height: number; // device px
}

export function createCamera(): Camera {
  return { centerX: 0, centerY: 0, zoom: 1 };
}

export function screenToWorld(
  cam: Camera,
  vp: Viewport,
  sx: number,
  sy: number
): { x: number; y: number } {
  return {
    x: cam.centerX + (sx - vp.width / 2) / cam.zoom,
    y: cam.centerY + (sy - vp.height / 2) / cam.zoom,
  };
}

// Pan by a screen-space delta (device px).
export function panByScreen(cam: Camera, dx: number, dy: number): void {
  cam.centerX -= dx / cam.zoom;
  cam.centerY -= dy / cam.zoom;
}

// Zoom keeping the world point under the cursor fixed.
export function zoomAt(cam: Camera, vp: Viewport, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(cam, vp, sx, sy);
  cam.zoom = Math.max(0.02, Math.min(500, cam.zoom * factor));
  const after = screenToWorld(cam, vp, sx, sy);
  cam.centerX += before.x - after.x;
  cam.centerY += before.y - after.y;
}

// Fit a world bounds rect into the viewport with padding.
export function fitBounds(
  cam: Camera,
  vp: Viewport,
  b: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 0.9
): void {
  const w = Math.max(1e-6, b.maxX - b.minX);
  const h = Math.max(1e-6, b.maxY - b.minY);
  cam.centerX = (b.minX + b.maxX) / 2;
  cam.centerY = (b.minY + b.maxY) / 2;
  cam.zoom = Math.min(vp.width / w, vp.height / h) * pad;
}

// Uniforms consumed by the shaders: map world -> clip.
// clip.x = (screenX / W) * 2 - 1 ; clip.y = 1 - (screenY / H) * 2
export function cameraUniforms(cam: Camera, vp: Viewport) {
  return {
    u_center: [cam.centerX, cam.centerY] as [number, number],
    u_zoom: cam.zoom,
    u_viewport: [vp.width, vp.height] as [number, number],
  };
}
