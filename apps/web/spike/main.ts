// THROWAWAY Phase 0 spike — orchestration, input, HUD, measurement loop.
// Headline metric: sustained pan/zoom FPS with EVERYTHING visible (fit-all),
// fills on, at DPR<=2. That is the worst case; viewport culling only makes the
// zoomed-in case cheaper, so this number is the conservative go/no-go gate.

import { generateWorkload } from './geometry';
import { createSpikeRenderer } from './renderer';
import { buildSpatialIndex } from './spatial';
import {
  createCamera,
  fitBounds,
  panByScreen,
  screenToWorld,
  zoomAt,
  type Viewport,
} from './camera';

const DPR = Math.min(window.devicePixelRatio || 1, 2);

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;

// --- URL params let you sweep the workload without editing code ---
const params = new URLSearchParams(location.search);
const regionCount = Number(params.get('regions') ?? 100);
const segmentsPerRegion = Number(params.get('seg') ?? 5000);

const t0 = performance.now();
const workload = generateWorkload({ regionCount, segmentsPerRegion });
const genMs = performance.now() - t0;

const t1 = performance.now();
const index = buildSpatialIndex(workload.strokes, 120);
const indexMs = performance.now() - t1;

const renderer = createSpikeRenderer(canvas, workload.strokes, workload.fills);

const cam = createCamera();
const vp: Viewport = { width: 1, height: 1 };

function resize() {
  const rect = canvas.getBoundingClientRect();
  vp.width = Math.max(1, Math.round(rect.width * DPR));
  vp.height = Math.max(1, Math.round(rect.height * DPR));
  canvas.width = vp.width;
  canvas.height = vp.height;
}
resize();
new ResizeObserver(resize).observe(canvas);
// initial fit once we have a viewport
requestAnimationFrame(() => {
  resize();
  fitBounds(cam, vp, workload.bounds);
});

// --- interaction state ---
let dragging = false;
let lastX = 0;
let lastY = 0;
let drawFills = true;
let autoPan = true;
let hover = -1;
let hoverMs = 0;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  autoPan = false;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) {
    panByScreen(cam, (e.clientX - lastX) * DPR, (e.clientY - lastY) * DPR);
    lastX = e.clientX;
    lastY = e.clientY;
    return;
  }
  // hover hit-test (the interaction-latency probe)
  const rect = canvas.getBoundingClientRect();
  const w = screenToWorld(cam, vp, (e.clientX - rect.left) * DPR, (e.clientY - rect.top) * DPR);
  const tolWorld = 6 / cam.zoom; // ~6px hit tolerance
  const hs = performance.now();
  hover = index.query(w.x, w.y, tolWorld);
  hoverMs = performance.now() - hs;
  renderer.setHighlight(workload.strokes, hover);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    autoPan = false;
    const rect = canvas.getBoundingClientRect();
    const factor = Math.pow(1.0015, -e.deltaY);
    zoomAt(cam, vp, (e.clientX - rect.left) * DPR, (e.clientY - rect.top) * DPR, factor);
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'f') drawFills = !drawFills;
  if (e.key === 'a') autoPan = !autoPan;
  if (e.key === 'r') fitBounds(cam, vp, workload.bounds);
});

// --- headless benchmark (rAF-independent) ---
// The preview tab is often backgrounded, which throttles requestAnimationFrame,
// so wall-clock rAF deltas are useless. __bench() draws N frames synchronously
// at a fixed device resolution and forces GPU completion with finish(), giving a
// real render-throughput number for the go/no-go gate.
(window as unknown as { __bench: unknown }).__bench = (
  frames = 240,
  deviceW = 2560,
  deviceH = 1440,
  perFrameFinish = false
) => {
  const gl = renderer.regl._gl as WebGLRenderingContext | WebGL2RenderingContext;
  // fixed resolution so the number is reproducible regardless of layout
  canvas.width = deviceW;
  canvas.height = deviceH;
  vp.width = deviceW;
  vp.height = deviceH;
  renderer.regl.poll(); // make regl pick up the new drawing-buffer size
  fitBounds(cam, vp, workload.bounds);
  const fz = cam.zoom;
  const cx = (workload.bounds.minX + workload.bounds.maxX) / 2;
  const cy = (workload.bounds.minY + workload.bounds.maxY) / 2;
  const span = (workload.bounds.maxX - workload.bounds.minX) * 0.04;
  const px = new Uint8Array(4);
  const forceGpu = () => gl.readPixels(deviceW >> 1, deviceH >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const step = (ph: number, force: boolean) => {
    cam.zoom = fz * (1 + 0.12 * Math.sin(ph)); // "breathing" -> everything visible, always moving
    cam.centerX = cx + Math.cos(ph) * span;
    cam.centerY = cy + Math.sin(ph * 1.3) * span;
    renderer.draw(cam, vp, { drawFills: true, highlight: -1 });
    if (force) forceGpu();
  };
  for (let i = 0; i < 12; i++) step(i * 0.03, false); // warmup
  gl.finish();

  // pixel sanity: count non-background pixels in a center crop so we KNOW the
  // scene actually rendered (background clear color ~ (28,33,43)).
  const crop = new Uint8Array(64 * 64 * 4);
  gl.readPixels(deviceW / 2 - 32, deviceH / 2 - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, crop);
  let nonBg = 0;
  for (let i = 0; i < crop.length; i += 4) {
    if (Math.abs(crop[i] - 28) > 12 || Math.abs(crop[i + 1] - 33) > 12 || Math.abs(crop[i + 2] - 43) > 12)
      nonBg++;
  }

  const start = performance.now();
  for (let i = 0; i < frames; i++) step(i * 0.03, perFrameFinish);
  forceGpu(); // force the whole batch to complete
  gl.finish();
  const ms = performance.now() - start;
  return {
    frames,
    device: `${deviceW}x${deviceH}`,
    dpr: DPR,
    segments: workload.strokes.count,
    fillTris: workload.fills.count / 3,
    nonBgPixels: `${nonBg}/4096`,
    msTotal: +ms.toFixed(1),
    msPerFrame: +(ms / frames).toFixed(3),
    fps: +(1000 / (ms / frames)).toFixed(1),
  };
};

// --- measurement ---
const frameTimes: number[] = [];
let last = performance.now();
let fitZoom = 0;
let phase = 0;

function loop() {
  const now = performance.now();
  const dt = now - last;
  last = now;
  frameTimes.push(dt);
  if (frameTimes.length > 90) frameTimes.shift();

  if (autoPan) {
    // Keep the full workload on screen and continuously moving so nothing is
    // static: gentle zoom "breathing" + small orbit around fit.
    if (fitZoom === 0) {
      fitBounds(cam, vp, workload.bounds);
      fitZoom = cam.zoom;
    }
    phase += dt * 0.001;
    cam.zoom = fitZoom * (1 + 0.12 * Math.sin(phase));
    const span = (workload.bounds.maxX - workload.bounds.minX) * 0.04;
    cam.centerX = (workload.bounds.minX + workload.bounds.maxX) / 2 + Math.cos(phase) * span;
    cam.centerY = (workload.bounds.minY + workload.bounds.maxY) / 2 + Math.sin(phase * 1.3) * span;
  } else {
    fitZoom = 0;
  }

  renderer.draw(cam, vp, { drawFills, highlight: hover });

  // rolling stats
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
  const fps = 1000 / avg;

  hud.innerHTML = `
    <div class="row"><b>Phase 0 spike</b> <span class="muted">DPR ${DPR}</span></div>
    <div class="row big ${fps >= 58 ? 'ok' : 'bad'}">${fps.toFixed(1)} fps</div>
    <div class="row">frame avg <b>${avg.toFixed(2)}ms</b> · p95 <b>${p95.toFixed(2)}ms</b></div>
    <div class="row">segments <b>${workload.strokes.count.toLocaleString()}</b></div>
    <div class="row">fill tris <b>${(workload.fills.count / 3).toLocaleString()}</b> · objects <b>${workload.regionCount}</b></div>
    <div class="row">hover query <b>${hoverMs.toFixed(3)}ms</b> ${hover >= 0 ? `(seg ${hover})` : ''}</div>
    <div class="row muted">gen ${genMs.toFixed(0)}ms · index ${indexMs.toFixed(0)}ms</div>
    <div class="row muted">fills ${drawFills ? 'on' : 'off'} (f) · auto-pan ${autoPan ? 'on' : 'off'} (a) · fit (r)</div>
    <div class="row muted">drag=pan · wheel=zoom · move=hover</div>
  `;

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
