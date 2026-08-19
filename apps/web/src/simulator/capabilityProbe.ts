/**
 * Dev-only console hook: `__simCapabilityProbe()`.
 *
 * Answers the questions that decide how inline simulation windows can render, in
 * whatever webview is actually hosting the app — a browser tab, or the Tauri
 * WKWebView / WebKitGTK shell, which is the case that cannot be measured from
 * outside.
 *
 * Three things are unknown per-engine and cheap to establish:
 *
 * 1. **How many live WebGL2 contexts a single worker gets.** Browsers cap this
 *    and evict the oldest *silently* — no exception, just a `webglcontextlost`
 *    on a context someone is still using. Chromium 148 gives 4 per worker
 *    (16 on the main thread), so a naive context-per-window design breaks at the
 *    fifth window.
 * 2. **Whether the fan-out path exists at all**: `OffscreenCanvas` in a worker,
 *    `transferToImageBitmap()`, and a `bitmaprenderer` context on the visible
 *    canvas. That path needs exactly one WebGL2 context however many windows are
 *    open, which is why it is the design we want.
 * 3. **What the fan-out costs** at a realistic size, so the concurrent-window cap
 *    is chosen from a measurement rather than a guess.
 *
 * Run it from the console and paste the result into the plan's Phase 0.
 */

export interface SimCapabilityReport {
  userAgent: string;
  /** Live WebGL2 contexts a single worker sustained before eviction started. */
  workerContextCap: number;
  /** Whether every worker context reported EXT_color_buffer_float (solver needs it). */
  workerFloatRenderTargets: boolean;
  /** OffscreenCanvas + transferToImageBitmap + bitmaprenderer all present. */
  fanOutSupported: boolean;
  /** Worker-side ms for one render + transferToImageBitmap at `fanOutSize`. */
  fanOutMsPerFrame: number | null;
  fanOutSize: number;
  notes: string[];
}

/** Contexts to attempt in one worker. Chromium caps at 4; leave headroom. */
const PROBE_CONTEXTS = 10;
/** Render size for the fan-out timing, in device pixels. */
const FAN_OUT_SIZE = 512;
/** Frames to time; the first few are discarded as warm-up. */
const FAN_OUT_FRAMES = 40;
const FAN_OUT_WARMUP = 10;

const CONTEXT_CAP_WORKER = `
  const ctxs = [];
  self.onmessage = (e) => {
    if (e.data.kind === 'add') {
      const gl = e.data.canvas.getContext('webgl2', { depth: true });
      const float = gl ? !!gl.getExtension('EXT_color_buffer_float') : false;
      if (gl) ctxs.push(gl);
      self.postMessage({ kind: 'added', ok: !!gl, float });
    } else if (e.data.kind === 'audit') {
      self.postMessage({
        kind: 'audit',
        alive: ctxs.filter((g) => !g.isContextLost()).length,
        total: ctxs.length,
      });
    }
  };
`;

const FAN_OUT_WORKER = `
  let gl = null, canvas = null, program = null;
  self.onmessage = (e) => {
    if (e.data.kind === 'init') {
      try {
        canvas = new OffscreenCanvas(e.data.size, e.data.size);
        gl = canvas.getContext('webgl2', { depth: true, antialias: true });
        if (!gl) { self.postMessage({ kind: 'ready', ok: false, reason: 'no webgl2 in worker' }); return; }
        if (typeof canvas.transferToImageBitmap !== 'function') {
          self.postMessage({ kind: 'ready', ok: false, reason: 'no transferToImageBitmap' });
          return;
        }
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }');
        gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, 'precision mediump float; void main(){ gl_FragColor = vec4(0.3, 0.5, 0.8, 1.0); }');
        gl.compileShader(fs);
        program = gl.createProgram();
        gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.8,-0.8, 0.8,-0.8, 0.0,0.8]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(program, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        self.postMessage({ kind: 'ready', ok: true });
      } catch (error) {
        self.postMessage({ kind: 'ready', ok: false, reason: String(error) });
      }
    } else if (e.data.kind === 'frame') {
      const started = performance.now();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.05, 0.06, 0.07, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const bitmap = canvas.transferToImageBitmap();
      const ms = performance.now() - started;
      self.postMessage({ kind: 'frame', bitmap, ms }, [bitmap]);
    }
  };
`;

function spawn(source: string): Worker {
  return new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
}

function once<T>(worker: Worker, kind: string): Promise<T> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.kind !== kind) return;
      worker.removeEventListener('message', listener);
      resolve(event.data as T);
    };
    worker.addEventListener('message', listener);
  });
}

/** Give the engine a moment to fire the eviction it does asynchronously. */
function settle(ms = 250): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Add transferred canvases to one worker until the live count stops rising. The
 * cap is the highest count at which every context created so far was still
 * alive — past it, the engine has started evicting.
 */
async function measureWorkerContextCap(notes: string[]): Promise<{ cap: number; float: boolean }> {
  const worker = spawn(CONTEXT_CAP_WORKER);
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(holder);
  let cap = 0;
  let float = true;
  try {
    for (let i = 0; i < PROBE_CONTEXTS; i += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      holder.appendChild(canvas);
      let offscreen: OffscreenCanvas;
      try {
        offscreen = canvas.transferControlToOffscreen();
      } catch (error) {
        notes.push(`transferControlToOffscreen unavailable: ${String(error)}`);
        break;
      }
      worker.postMessage({ kind: 'add', canvas: offscreen }, [offscreen]);
      const added = await once<{ ok: boolean; float: boolean }>(worker, 'added');
      if (!added.ok) {
        notes.push(`worker context ${i + 1} failed to create`);
        break;
      }
      if (!added.float) float = false;
      await settle();
      worker.postMessage({ kind: 'audit' });
      const audit = await once<{ alive: number; total: number }>(worker, 'audit');
      if (audit.alive < audit.total) {
        notes.push(`eviction began at ${audit.total} worker contexts (${audit.alive} alive)`);
        break;
      }
      cap = audit.alive;
    }
  } finally {
    worker.terminate();
    holder.remove();
  }
  return { cap, float };
}

/** Time render + transferToImageBitmap + transferFromImageBitmap for one frame. */
async function measureFanOut(
  notes: string[],
): Promise<{ supported: boolean; msPerFrame: number | null }> {
  if (typeof OffscreenCanvas === 'undefined') {
    notes.push('OffscreenCanvas is not available');
    return { supported: false, msPerFrame: null };
  }
  const target = document.createElement('canvas');
  target.width = FAN_OUT_SIZE;
  target.height = FAN_OUT_SIZE;
  const renderer = target.getContext('bitmaprenderer');
  if (!renderer) {
    notes.push('bitmaprenderer context is not available — fan-out cannot present');
    return { supported: false, msPerFrame: null };
  }

  const worker = spawn(FAN_OUT_WORKER);
  try {
    worker.postMessage({ kind: 'init', size: FAN_OUT_SIZE });
    const ready = await once<{ ok: boolean; reason?: string }>(worker, 'ready');
    if (!ready.ok) {
      notes.push(`fan-out worker init failed: ${ready.reason ?? 'unknown'}`);
      return { supported: false, msPerFrame: null };
    }
    const samples: number[] = [];
    for (let i = 0; i < FAN_OUT_FRAMES; i += 1) {
      worker.postMessage({ kind: 'frame' });
      const frame = await once<{ bitmap: ImageBitmap; ms: number }>(worker, 'frame');
      renderer.transferFromImageBitmap(frame.bitmap);
      if (i >= FAN_OUT_WARMUP) samples.push(frame.ms);
    }
    const mean = samples.reduce((total, value) => total + value, 0) / (samples.length || 1);
    return { supported: true, msPerFrame: mean };
  } finally {
    worker.terminate();
  }
}

export async function probeSimulatorCapabilities(): Promise<SimCapabilityReport> {
  const notes: string[] = [];
  const { cap, float } = await measureWorkerContextCap(notes);
  const { supported, msPerFrame } = await measureFanOut(notes);
  return {
    userAgent: navigator.userAgent,
    workerContextCap: cap,
    workerFloatRenderTargets: float,
    fanOutSupported: supported,
    fanOutMsPerFrame: msPerFrame,
    fanOutSize: FAN_OUT_SIZE,
    notes,
  };
}

declare global {
  var __simCapabilityProbe: (() => Promise<SimCapabilityReport>) | undefined;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  globalThis.__simCapabilityProbe = probeSimulatorCapabilities;
}

/** Imported for its side effect; see the hook above. */
export const simCapabilityProbeInstalled = true;
