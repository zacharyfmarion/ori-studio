/* eslint-disable i18next/no-literal-string -- Local, unshipped research tool. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { cameraSpreadStrain, type CameraSpreadLift } from '../../cp-workspace/folded/cameraSpreadLift';
import type { CameraSpreadOptions } from '../../cp-workspace/folded/cameraSpreadScene';
import { foldedFlatPaperScene } from '../../cp-workspace/folded/foldedFlatScene';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { PaperScene } from '../../lib/paper/paperScene';
import { createCameraRenderer } from './cameraRenderer';
import { readJson, storageKey, writeJson } from '../../lib/storage';
import styles from './CameraSpreadExplorer.module.css';

interface Model {
  id: string;
  faces?: number;
  edges: number;
  status: string;
}
interface Manifest {
  total: number;
  models: Model[];
}
const DATA = '/src/generated/camera-spread/';
const initial: CameraSpreadOptions = {
  amount: 0.06,
  directionDeg: 247,
  inclinationDeg: 45,
  projection: 'diagram',
};
const nice = (id: string) => id.replaceAll('-', ' ').replace(/ by /, ' · ');
const percent = (n: number) => (100 * n).toFixed(2) + '%';

function drawFlat(canvas: HTMLCanvasElement, scene: PaperScene, zoom: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { minX, minY, maxX, maxY } = scene.bounds;
  const extent = Math.max(maxX - minX, maxY - minY);
  const scale = (Math.min(canvas.width, canvas.height) * 0.7 * zoom) / Math.max(extent, 1e-9);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const item of scene.items) {
    if (item.hidden) continue;
    if (item.kind === 'face') {
      ctx.beginPath();
      for (const ring of item.rings) {
        ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      }
      ctx.fillStyle = item.side === 'front' ? '#ffe375' : '#e0e5eb';
      ctx.fill('evenodd');
      if (item.outline) {
        ctx.strokeStyle = '#20242e';
        ctx.lineWidth = (1.1 * dpr) / scale;
        ctx.stroke();
      }
    } else if (item.kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(...item.a);
      ctx.lineTo(...item.b);
      ctx.strokeStyle = item.role === 'aux' ? '#a0a6ad' : '#20242e';
      ctx.lineWidth = ((item.role === 'aux' ? 0.65 : 1.1) * dpr) / scale;
      ctx.stroke();
    }
  }
}
function FlatCanvas({
  kernel,
  spread,
  zoom,
  label,
}: {
  kernel: OristudioCpFoldedPaperScene;
  spread?: LayerSpreadOptions;
  zoom: number;
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(
    () =>
      foldedFlatPaperScene(kernel, {
        markHidden: false,
        toScenePx: (p) => [p.x, p.y],
        scale: 1,
        spread,
      }),
    [kernel, spread]
  );
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const render = () => drawFlat(node, scene, zoom);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => observer.disconnect();
  }, [scene, zoom]);
  return <canvas ref={canvas} className={styles.canvas} aria-label={label} />;
}
function CameraCanvas({
  kernel,
  mesh,
  options,
  zoom,
  wire,
  onTime,
}: {
  kernel: OristudioCpFoldedPaperScene;
  mesh: CameraSpreadLift;
  options: CameraSpreadOptions;
  zoom: number;
  wire: boolean;
  onTime: (ms: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createCameraRenderer> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!canvas.current) return;
    try {
      renderer.current = createCameraRenderer(canvas.current, mesh, kernel);
    } catch (e) {
      setError(String(e));
    }
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, [mesh, kernel]);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const draw = () => {
      const start = performance.now();
      renderer.current?.draw(options, zoom, wire);
      onTime(performance.now() - start);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(node);
    return () => observer.disconnect();
  }, [options, zoom, wire, onTime, mesh]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      <canvas ref={canvas} className={styles.canvas} aria-label="Camera distortion result" />
    </>
  );
}
function Dial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const change = (e: React.PointerEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(
      (Math.round(
        (Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180) / Math.PI
      ) +
        360) %
        360
    );
  };
  return (
    <button
      className={styles.dial}
      aria-label="Drag to change viewing direction"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        change(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) change(e);
      }}
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="40" />
        <path d="M50 6v8M94 50h-8M50 94v-8M6 50h8" />
        <g transform={`rotate(${value} 50 50)`}>
          <path d="M50 50H84M76 43l8 7-8 7" />
        </g>
        <circle cx="50" cy="50" r="3" />
      </svg>
    </button>
  );
}
function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [model, setModel] = useState('frog-frog-by-gen-hagiwara');
  const [kernel, setKernel] = useState<OristudioCpFoldedPaperScene | null>(null);
  const [mesh, setMesh] = useState<CameraSpreadLift | null>(null);
  const [error, setError] = useState('');
  const [options, setOptions] = useState(initial);
  const [comparison, setComparison] = useState('flat');
  const [zoom, setZoom] = useState(1);
  const [wire, setWire] = useState(false);
  const [frameMs, setFrameMs] = useState(0);
  const [verdict, setVerdict] = useState('');
  const [notes, setNotes] = useState('');
  const [reviews, setReviews] = useState<Array<Record<string, unknown>>>(() => {
    const stored = readJson<unknown>(storageKey('research', 'camera-spread-reviews'), []);
    return Array.isArray(stored) ? stored : [];
  });
  useEffect(() => {
    void fetch(DATA + 'manifest.json')
      .then((r) => {
        if (!r.ok) throw new Error('Prepare the corpus first: see scripts/camera-spread/README.md');
        return r.json();
      })
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let worker: Worker | undefined;
    setKernel(null);
    setMesh(null);
    setError('');
    setVerdict('');
    setNotes('');
    void fetch(DATA + encodeURIComponent(model) + '.json', {
      signal: abort.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error('Model data is missing');
        return r.json();
      })
      .then(({ scene }) => {
        if (abort.signal.aborted) return;
        setKernel(scene);
        worker = new Worker(new URL('./liftWorker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (e) => {
          if (e.data.error) setError(e.data.error);
          else setMesh(e.data.mesh);
        };
        worker.onerror = (e) => setError(e.message);
        worker.postMessage(scene);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => {
      abort.abort();
      worker?.terminate();
    };
  }, [model]);
  const set = <K extends keyof CameraSpreadOptions>(key: K, value: CameraSpreadOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));
  const spread = useMemo<LayerSpreadOptions | undefined>(
    () =>
      comparison === 'depth'
        ? { kind: 'depth', amount: options.amount, toward: 'down' }
        : comparison === 'affine'
          ? {
              kind: 'affine',
              amount: options.amount,
              keep: 'top',
              skew: 1,
              axisDeg: 81,
            }
          : undefined,
    [comparison, options.amount]
  );
  const strain = useMemo(
    () => (mesh ? cameraSpreadStrain(mesh, options.amount) : null),
    [mesh, options.amount]
  );
  const models = manifest?.models.filter((m) => m.status === 'solved') ?? [];
  const selected = manifest?.models.find((m) => m.id === model);
  const saveReview = () => {
    const next = [...reviews, { model, options, verdict, notes, at: new Date().toISOString() }];
    setReviews(next);
    writeJson(storageKey('research', 'camera-spread-reviews'), next);
    setNotes('');
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(reviews, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'camera-spread-review.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>ORI STUDIO / RESEARCH LAB</div>
          <h1>Give the drawing a little depth.</h1>
          <p>Connected paper. A movable camera. Your real crease patterns.</p>
        </div>
        <span className={styles.badge}>Experimental · local only</span>
      </header>
      <section className={styles.selector}>
        <label>
          Corpus model
          <select aria-label="Corpus model" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {nice(m.id)} · {m.faces} faces
              </option>
            ))}
          </select>
        </label>
        <div>
          <b>
            {manifest?.models.length ?? '…'} / {manifest?.total ?? '…'}
          </b>
          <span>patterns sampled</span>
        </div>
        <div>
          <b>{selected?.faces ?? '…'}</b>
          <span>folded faces</span>
        </div>
      </section>
      <div className={styles.layout}>
        <section className={styles.stage}>
          <div className={styles.cards}>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <span>01 / COMPARE</span>
                <select
                  aria-label="Comparison mode"
                  value={comparison}
                  onChange={(e) => setComparison(e.target.value)}
                >
                  <option value="flat">Original flat drawing</option>
                  <option value="affine">Existing affine spread</option>
                  <option value="depth">Existing depth spread · down</option>
                </select>
              </div>
              {kernel && (
                <FlatCanvas kernel={kernel} spread={spread} zoom={zoom} label="Comparison drawing" />
              )}
            </article>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <span>02 / CAMERA LIFT</span>
                <span className={styles.live}>{mesh ? 'Live · cached geometry' : 'Preparing mesh…'}</span>
              </div>
              {kernel && options.amount === 0 ? (
                <FlatCanvas kernel={kernel} zoom={zoom} label="Camera distortion at zero" />
              ) : kernel && mesh ? (
                <CameraCanvas
                  kernel={kernel}
                  mesh={mesh}
                  options={options}
                  zoom={zoom}
                  wire={wire}
                  onTime={setFrameMs}
                />
              ) : (
                <div className={styles.loading}>
                  {error || 'Solving shared heights and layer constraints…'}
                </div>
              )}
            </article>
          </div>
          <div className={styles.stats}>
            <div>
              <b>{mesh ? (mesh.diagnostics.prepareMs + mesh.diagnostics.solveMs).toFixed(0) + ' ms' : '…'}</b>
              <span>one-time preparation</span>
            </div>
            <div>
              <b>{frameMs.toFixed(1)} ms</b>
              <span>CPU draw submission</span>
            </div>
            <div>
              <b>{strain ? `${percent(strain.p95)} / ${percent(strain.max)}` : '…'}</b>
              <span>edge stretch · 95th / worst</span>
            </div>
            <div data-warning={!!mesh?.diagnostics.probeInversions}>
              <b>
                {mesh
                  ? `${(options.amount === 0 ? 0 : mesh.diagnostics.probeInversions).toLocaleString()} / ${mesh.diagnostics.probeCount.toLocaleString()}`
                  : '…'}
              </b>
              <span>layer-order failures at probe points</span>
            </div>
          </div>
          <p className={styles.notice}>
            Research result: the mesh stays connected, but this height fit can stretch paper and invert layer
            order. Visibility is depth-tested; it does not repair intersections. Do not treat this as a
            validated fold.
          </p>
          <details className={styles.details}>
            <summary>What to look for</summary>
            <p>
              Try small amounts first. Rotate the direction and compare exposed edges. Look for slivers
              crossing enclosing folds, asymmetric flaps, and swollen panels. Diagram camera keeps the flat
              outline; 3D cameras foreshorten it. At amount zero, both views use the exact original drawing.
            </p>
            <p>
              Top-down orthographic cannot reveal pure height differences. Top-down perspective can reveal
              them through size differences. Mesh overlay shows the bending triangles. The current fit does
              not solve physical hinge angles.
            </p>
            <p>
              Sample: 24 deterministic edge-count quantiles plus eight named regression models. All{' '}
              {models.length} selected patterns folded successfully. This is not all {manifest?.total} corpus
              files. Preparation runs in a cancellable worker; controls only update camera uniforms.
            </p>
          </details>
          <section className={styles.review}>
            <h2>Keep a validation note</h2>
            <div className={styles.reviewRow}>
              <select
                aria-label="Visual verdict"
                value={verdict}
                onChange={(e) => setVerdict(e.target.value)}
              >
                <option value="">Choose a verdict…</option>
                <option>Useful at these settings</option>
                <option>Visible intersections</option>
                <option>Too much bending or stretch</option>
                <option>No useful improvement</option>
              </select>
              <input
                aria-label="Validation notes"
                placeholder="e.g. right leg opens well; underside cuts through the body"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button disabled={!verdict} onClick={saveReview}>
                Save note
              </button>
              <button disabled={!reviews.length} onClick={download}>
                Export {reviews.length} notes
              </button>
            </div>
            <p>Saved in this browser, with the model and all camera settings. Nothing is uploaded.</p>
          </section>
        </section>
        <aside className={styles.controls}>
          <h2>Camera distortion</h2>
          <label className={styles.slider}>
            Amount <output>{(options.amount * 100).toFixed(1)}%</output>
            <input
              aria-label="Distortion amount"
              type="range"
              min="0"
              max=".15"
              step=".005"
              value={options.amount}
              onChange={(e) => set('amount', Number(e.target.value))}
            />
          </label>
          <div className={styles.direction}>
            <Dial value={options.directionDeg} onChange={(v) => set('directionDeg', v)} />
            <label>
              Direction
              <input
                aria-label="Viewing direction"
                type="number"
                min="0"
                max="360"
                value={options.directionDeg}
                onChange={(e) => set('directionDeg', Number(e.target.value))}
              />
              <span>degrees around the model</span>
            </label>
          </div>
          <input
            aria-label="Direction slider"
            type="range"
            min="0"
            max="359"
            step="1"
            value={options.directionDeg}
            onChange={(e) => set('directionDeg', Number(e.target.value))}
          />
          <label>
            Camera
            <select
              aria-label="Camera projection"
              value={options.projection}
              onChange={(e) =>
                setOptions((o) => ({
                  ...o,
                  projection: e.target.value as CameraSpreadOptions['projection'],
                  inclinationDeg:
                    e.target.value === 'diagram' ? Math.min(80, o.inclinationDeg) : o.inclinationDeg,
                }))
              }
            >
              <option value="diagram">Diagram · preserve flat outline</option>
              <option value="orthographic">3D · orthographic</option>
              <option value="perspective">3D · perspective</option>
            </select>
          </label>
          <label className={styles.slider}>
            Inclination <output>{options.inclinationDeg}°</output>
            <input
              aria-label="Camera inclination"
              type="range"
              min="0"
              max={options.projection === 'diagram' ? 80 : 180}
              step="1"
              value={options.inclinationDeg}
              onChange={(e) => set('inclinationDeg', Number(e.target.value))}
            />
          </label>
          <div className={styles.presets}>
            <button
              onClick={() =>
                setOptions((o) => ({
                  ...o,
                  projection: 'perspective',
                  inclinationDeg: 0,
                }))
              }
            >
              Top down
            </button>
            <button
              onClick={() =>
                setOptions((o) => ({
                  ...o,
                  projection: 'orthographic',
                  inclinationDeg: 75,
                }))
              }
            >
              Side
            </button>
            <button
              onClick={() =>
                setOptions((o) => ({
                  ...o,
                  projection: 'orthographic',
                  inclinationDeg: 150,
                }))
              }
            >
              Underside
            </button>
          </div>
          <label className={styles.slider}>
            Zoom <output>{Math.round(zoom * 100)}%</output>
            <input
              aria-label="Preview zoom"
              type="range"
              min=".6"
              max="2.5"
              step=".05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} />
            Show bending mesh
          </label>
          <button
            className={styles.reset}
            onClick={() => {
              setOptions(initial);
              setZoom(1);
              setWire(false);
            }}
          >
            Reset camera
          </button>
          <div className={styles.small}>
            Amount bounds the added thickness relative to the model. Direction 0° is right; 90° is down. Near
            edge-on, use the 3D camera to avoid extreme diagram stretching.
          </div>
        </aside>
      </div>
    </main>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
