import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureSpatialSpread } from '../../../apps/web/src/cp-workspace/folded/folded3dSpread';
import { folded3dSceneCamera } from '../../../apps/web/src/cp-workspace/folded/folded3dScene';
import {
  folded3dMeshPayload,
  folded3dWindowRenderSettings,
} from '../../../apps/web/src/cp-workspace/folded/folded3dWindow';
import { FoldedMeshSource } from '../../../apps/web/src/simulator/foldedMeshSource';
import { useFolded3dMeshRuntime } from '../../../apps/web/src/cp-workspace/folded/useFolded3dMeshRuntime';
import { peekSimulatorClient } from '../../../apps/web/src/store/workspaceStore/simulatorRuntime';
import {
  surfacePaperStyle,
  PAPER_STYLE_POLICIES,
} from '../../../apps/web/src/lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_STYLE } from '../../../apps/web/src/lib/paper/paperStyle';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../../apps/web/src/cp-workspace/folded/folded3dCamera';
import type { Folded3dMesh } from '../../../apps/web/src/cp-workspace/folded/folded3dMesh';

const params = new URLSearchParams(location.search);
const name = params.get('model') ?? 'penguin';
const size = Number(params.get('size') ?? 800);
const interval = Number(params.get('interval') ?? 8);
const duration = 3000;
const output = document.querySelector('#result')!;
const style = surfacePaperStyle(
  DEFAULT_PAPER_STYLE,
  PAPER_STYLE_POLICIES['folded-3d']
);
const settings = {
  ...folded3dWindowRenderSettings({
    style,
    displayStyle: 'Paper5',
    devicePixelRatio: 1,
  }),
  displacementScale: 1,
};
const orbit = (t: number) => ({
  ...DEFAULT_FOLDED_3D_CAMERA,
  zoom: 0.82,
  yaw: DEFAULT_FOLDED_3D_CAMERA.yaw + t * Math.PI * 2,
  pitch: 0.4 + Math.sin(t * 6) * 0.3,
});
const summarize = (xs: number[]) => {
  const sorted = xs.toSorted((a, b) => a - b);
  return {
    count: xs.length,
    mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length),
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
};

async function gpuBenchmark(mesh: Folded3dMesh) {
  const buffer = new OffscreenCanvas(size, size);
  const source = FoldedMeshSource.create(
    buffer,
    folded3dMeshPayload(mesh).payload
  )!;
  const gl = buffer.getContext('webgl2')!;
  const counts: Record<string, number> = {};
  for (const name of [
    'drawElements',
    'drawArrays',
    'clear',
    'useProgram',
    'uniform1f',
    'uniform3fv',
  ]) {
    const original = (gl as any)[name].bind(gl);
    (gl as any)[name] = (...args: any[]) => {
      counts[name] = (counts[name] ?? 0) + 1;
      return original(...args);
    };
  }
  const submit: number[] = [],
    complete: number[] = [];
  for (let i = 0; i < 40; i++) {
    await new Promise(requestAnimationFrame);
    const start = performance.now();
    source.render(folded3dSceneCamera(orbit(i / 40), mesh, size), settings);
    const drawn = performance.now();
    // A one-pixel readback includes submitted GPU work. Kept out of production.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    if (i >= 10) {
      submit.push(drawn - start);
      complete.push(performance.now() - start);
    }
    if (i === 38) for (const key of Object.keys(counts)) counts[key] = 0;
  }
  source.dispose();
  return {
    submitMs: summarize(submit),
    completeMs: summarize(complete),
    callsPerFrame: counts,
  };
}

function RuntimeBenchmark({ mesh, gpu }: { mesh: Folded3dMesh; gpu: unknown }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const times = useRef<number[]>([]);
  const started = useRef(false);
  const runtime = useFolded3dMeshRuntime({
    mesh,
    onFrame(bitmap) {
      times.current.push(performance.now());
      const ctx = canvas.current!.getContext('2d')!;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    },
  });
  useEffect(() => {
    if (runtime.status !== 'ready' || started.current) return;
    started.current = true;
    runtime.setRenderSettings(settings);
    runtime.setCamera(orbit(0), size, size);
    let timer: ReturnType<typeof setInterval>;
    const warmup = setTimeout(async () => {
      await peekSimulatorClient()!.getPerfStats();
      times.current = [];
      const start = performance.now();
      let requested = 0;
      timer = setInterval(() => {
        const elapsed = performance.now() - start;
        runtime.setCamera(orbit(Math.min(1, elapsed / duration)), size, size);
        requested++;
        if (elapsed < duration) return;
        clearInterval(timer);
        const stopped = performance.now();
        setTimeout(async () => {
          const frames = times.current;
          const during = frames.filter((t) => t <= stopped);
          const result = {
            model: name,
            size,
            interval,
            durationMs: stopped - start,
            requested,
            presentedDuringInput: during.length,
            presentationsPerSecond: (during.length * 1000) / (stopped - start),
            presentationGapsMs: summarize(
              during.slice(1).map((t, i) => t - during[i]!)
            ),
            drainMs: Math.max(0, (frames.at(-1) ?? stopped) - stopped),
            worker: await peekSimulatorClient()!.getPerfStats(),
            gpu,
          };
          output.textContent = JSON.stringify(result, null, 2);
          // Existing dev-only sink; reports stay in ignored artifacts/sim-perf.
          void fetch('/__sim-perf', {
            method: 'POST',
            body: `[spatial-orbit] ${JSON.stringify(result)}`,
          });
        }, 3000);
      }, interval);
    }, 1000);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [runtime.status]);
  return (
    <canvas
      ref={canvas}
      width={size}
      height={size}
      style={{ width: 480, height: 480 }}
    />
  );
}

async function run() {
  // Fixtures can be generated after Vite starts. Avoid a transformed URL glob
  // whose cached file list would omit newly added local corpus examples.
  const sourcePath = `../../../artifacts/spatial-production/${name}.json`;
  const data = await (
    await fetch(new URL(sourcePath, import.meta.url))
  ).json();
  const mesh = await ensureSpatialSpread(data.render);
  const gpu = await gpuBenchmark(mesh);
  createRoot(document.querySelector('#app')!).render(
    <RuntimeBenchmark mesh={mesh} gpu={gpu} />
  );
}
run().catch((error) => {
  output.textContent = String(error.stack ?? error);
});
