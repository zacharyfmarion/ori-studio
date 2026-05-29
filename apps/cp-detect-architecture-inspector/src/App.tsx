import { useEffect, useMemo, useState } from 'react';
import { Activity, CircleDot, GitBranch, Layers3, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { fetchStage1Example, fetchStage1Examples, fetchStage2Example, fetchStage3Example, fetchStages } from './api';
import type {
  ArrangementAtomicEdge,
  ArrangementCarrier,
  ArrangementVertex,
  BoundaryContactPrimitive,
  ExampleRow,
  JunctionPrimitive,
  LinePrimitive,
  MapPayload,
  Stage1Response,
  Stage2Response,
  Stage3Response,
} from './types';

const BACKGROUND_OPTIONS = [
  'input',
  'line_probability',
  'junction_probability',
  'boundary_contact_probability',
  'non_crease_probability',
];

const ASSIGNMENT_LABELS: Record<number, string> = {
  0: 'M',
  1: 'V',
  2: 'B',
  3: 'U',
};

export function App() {
  const [serverOk, setServerOk] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<'stage1' | 'stage2' | 'stage3'>('stage3');
  const [threshold, setThreshold] = useState(0.65);
  const [mapSize, setMapSize] = useState(192);
  const [stage, setStage] = useState<Stage1Response | Stage2Response | Stage3Response | null>(null);
  const [loadingStage, setLoadingStage] = useState(false);
  const [background, setBackground] = useState('input');
  const [showLines, setShowLines] = useState(true);
  const [showJunctions, setShowJunctions] = useState(true);
  const [showContacts, setShowContacts] = useState(true);
  const [showLineEndpoints, setShowLineEndpoints] = useState(false);
  const [showInferredCrossings, setShowInferredCrossings] = useState(false);
  const [showSharedCarriers, setShowSharedCarriers] = useState(true);
  const [showAtomicEdges, setShowAtomicEdges] = useState(true);
  const [showSelectedEdges, setShowSelectedEdges] = useState(true);
  const [showRejectedEdges, setShowRejectedEdges] = useState(false);
  const [showUndecidedEdges, setShowUndecidedEdges] = useState(false);
  const [showCarrierGeometry, setShowCarrierGeometry] = useState(true);
  const [selectedMapId, setSelectedMapId] = useState('line_probability');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (activeStage === 'stage3') {
      setShowLines(false);
      setShowSharedCarriers(false);
      setShowAtomicEdges(false);
      setShowSelectedEdges(true);
      setShowUndecidedEdges(false);
      setShowRejectedEdges(false);
      setShowJunctions(true);
      setShowContacts(true);
      setShowLineEndpoints(false);
      setShowInferredCrossings(false);
      setShowCarrierGeometry(true);
    } else if (activeStage === 'stage2') {
      setShowLines(true);
      setShowSharedCarriers(true);
      setShowAtomicEdges(true);
      setShowSelectedEdges(false);
      setShowUndecidedEdges(false);
      setShowRejectedEdges(false);
      setShowJunctions(true);
      setShowContacts(true);
      setShowLineEndpoints(false);
      setShowInferredCrossings(false);
      setShowCarrierGeometry(false);
    } else {
      setShowLines(true);
      setShowSharedCarriers(false);
      setShowAtomicEdges(false);
      setShowSelectedEdges(false);
      setShowUndecidedEdges(false);
      setShowRejectedEdges(false);
      setShowJunctions(true);
      setShowContacts(true);
      setShowLineEndpoints(false);
      setShowInferredCrossings(false);
      setShowCarrierGeometry(false);
    }
  }, [activeStage]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchStages(), fetchStage1Examples()])
      .then(([, exampleResponse]) => {
        if (cancelled) return;
        setServerOk(true);
        setServerError(null);
        setExamples(exampleResponse.rows);
        setSelectedId((current) => current ?? exampleResponse.rows[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setServerOk(false);
        setServerError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setStage(null);
    setLoadingStage(true);
    const request =
      activeStage === 'stage3'
        ? fetchStage3Example(selectedId, { threshold, mapSize })
        : activeStage === 'stage2'
          ? fetchStage2Example(selectedId, { threshold, mapSize })
          : fetchStage1Example(selectedId, { threshold, mapSize });
    request
      .then((payload) => {
        if (cancelled) return;
        setStage(payload);
        setSelectedMapId((current) => (payload.maps.some((map) => map.id === current) ? current : (payload.maps[0]?.id ?? current)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setServerError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingStage(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, activeStage, threshold, mapSize, reloadToken]);

  const selectedMap = useMemo(
    () => stage?.maps.find((map) => map.id === selectedMapId) ?? stage?.maps[0] ?? null,
    [selectedMapId, stage?.maps],
  );

  const backgroundMap = useMemo(
    () => stage?.maps.find((map) => map.id === background) ?? null,
    [background, stage?.maps],
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Ori Studio</p>
          <h1>CP Detection Architecture Inspector</h1>
        </div>
        <div className={serverOk ? 'server-pill ok' : 'server-pill error'}>
          <Activity size={16} />
          <span>{serverOk ? 'Rust backend connected' : 'Backend unavailable'}</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="sample-panel">
          <PanelTitle icon={<CircleDot size={17} />} title="Samples" />
          <div className="sample-list">
            {examples.map((example) => (
              <button
                className={example.id === selectedId ? 'sample-row selected' : 'sample-row'}
                key={example.id}
                onClick={() => setSelectedId(example.id)}
              >
                <strong>{example.source_id ?? example.id}</strong>
                <span>
                  {example.family ?? 'unknown'} · {example.profile ?? 'unknown'} · {example.edge_count ?? 0} GT edges
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="main-panel">
          <div className="controls-panel">
            <PanelTitle icon={<SlidersHorizontal size={17} />} title="Evidence Extraction" />
            <label>
              Stage
              <select value={activeStage} onChange={(event) => setActiveStage(event.target.value as 'stage1' | 'stage2' | 'stage3')}>
                <option value="stage1">Stage 1: dense evidence</option>
                <option value="stage2">Stage 2: candidate arrangement</option>
                <option value="stage3">Stage 3: weighted selection</option>
              </select>
            </label>
            <label>
              Threshold
              <input
                min="0.05"
                max="0.95"
                step="0.01"
                type="number"
                value={threshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
            </label>
            <label>
              Map size
              <input
                min="64"
                max="512"
                step="32"
                type="number"
                value={mapSize}
                onChange={(event) => setMapSize(Number(event.target.value))}
              />
            </label>
            <label>
              Background
              <select value={background} onChange={(event) => setBackground(event.target.value)}>
                {BACKGROUND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="refresh-button"
              disabled={!selectedId || loadingStage}
              onClick={() => setReloadToken((value) => value + 1)}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>

          {serverError ? <div className="error-panel">{serverError}</div> : null}

          {activeStage === 'stage3' ? (
            <section className="summary-grid">
              <Metric label="selected edges" value={isStage3(stage) ? stage.selection.report.selected_edges : '...'} />
              <Metric label="undecided edges" value={isStage3(stage) ? stage.selection.report.undecided_edges : '...'} />
              <Metric label="weak promoted" value={isStage3(stage) ? stage.selection.report.weak_edges_promoted : '...'} />
              <Metric label="odd vertices" value={isStage3(stage) ? stage.selection.report.odd_degree_vertices : '...'} />
              <Metric
                label="total score"
                value={isStage3(stage) ? stage.selection.report.total_score.toFixed(1) : '...'}
              />
            </section>
          ) : activeStage === 'stage2' ? (
            <section className="summary-grid">
              <Metric label="observed carriers" value={hasArrangement(stage) ? stage.arrangement.report.observed_carriers : '...'} />
              <Metric
                label="shared alternatives"
                value={hasArrangement(stage) ? stage.arrangement.report.shared_carrier_alternatives : '...'}
              />
              <Metric label="observed junctions" value={hasArrangement(stage) ? stage.arrangement.report.observed_junctions : '...'} />
              <Metric label="inferred crossings" value={hasArrangement(stage) ? stage.arrangement.report.carrier_intersections : '...'} />
              <Metric
                label="suppressed crossings"
                value={hasArrangement(stage) ? stage.arrangement.report.suppressed_carrier_intersections : '...'}
              />
            </section>
          ) : (
            <section className="summary-grid">
              <Metric label="line primitives" value={stage?.report.line_primitives ?? '...'} />
              <Metric label="junctions" value={stage?.report.junction_primitives ?? '...'} />
              <Metric label="boundary contacts" value={stage?.report.boundary_contact_primitives ?? '...'} />
              <Metric label="Hough segments" value={stage?.report.hough_segments ?? '...'} />
              <Metric label="legacy dependency" value={stage?.report.legacy_dependency === false ? 'false' : '...'} />
            </section>
          )}

          <section className="viewer-and-maps">
            <div className="viewer-panel">
              <div className="viewer-toolbar">
                <PanelTitle
                  icon={activeStage !== 'stage1' ? <GitBranch size={17} /> : <Layers3 size={17} />}
                  title={
                    activeStage === 'stage3'
                      ? 'Input + Weighted Selection'
                      : activeStage === 'stage2'
                        ? 'Input + Candidate Arrangement'
                        : 'Input + Stage 1 Primitives'
                  }
                />
                <div className="toggle-row">
                  <label>
                    <input type="checkbox" checked={showLines} onChange={(event) => setShowLines(event.target.checked)} />
                    {activeStage !== 'stage1' ? 'observed carriers' : 'lines'}
                  </label>
                  {activeStage !== 'stage1' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showSharedCarriers}
                        onChange={(event) => setShowSharedCarriers(event.target.checked)}
                      />
                      shared alternatives
                    </label>
                  ) : null}
                  {activeStage === 'stage2' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showAtomicEdges}
                        onChange={(event) => setShowAtomicEdges(event.target.checked)}
                      />
                      atomic intervals
                    </label>
                  ) : null}
                  {activeStage === 'stage3' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showCarrierGeometry}
                        onChange={(event) => setShowCarrierGeometry(event.target.checked)}
                      />
                      carrier geometry
                    </label>
                  ) : null}
                  {activeStage === 'stage3' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showSelectedEdges}
                        onChange={(event) => setShowSelectedEdges(event.target.checked)}
                      />
                      selected
                    </label>
                  ) : null}
                  {activeStage === 'stage3' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showUndecidedEdges}
                        onChange={(event) => setShowUndecidedEdges(event.target.checked)}
                      />
                      undecided
                    </label>
                  ) : null}
                  {activeStage === 'stage3' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showRejectedEdges}
                        onChange={(event) => setShowRejectedEdges(event.target.checked)}
                      />
                      rejected
                    </label>
                  ) : null}
                  <label>
                    <input
                      type="checkbox"
                      checked={showJunctions}
                      onChange={(event) => setShowJunctions(event.target.checked)}
                    />
                    {activeStage !== 'stage1' ? 'observed junctions' : 'junctions'}
                  </label>
                  {activeStage !== 'stage1' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showLineEndpoints}
                        onChange={(event) => setShowLineEndpoints(event.target.checked)}
                      />
                      endpoints
                    </label>
                  ) : null}
                  {activeStage === 'stage2' ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={showInferredCrossings}
                        onChange={(event) => setShowInferredCrossings(event.target.checked)}
                      />
                      inferred crossings
                    </label>
                  ) : null}
                  <label>
                    <input
                      type="checkbox"
                      checked={showContacts}
                      onChange={(event) => setShowContacts(event.target.checked)}
                    />
                    contacts
                  </label>
                </div>
              </div>
              {isStage3(stage) ? (
                <SelectionViewer
                  backgroundMap={backgroundMap}
                  showCarrierGeometry={showCarrierGeometry}
                  showContacts={showContacts}
                  showJunctions={showJunctions}
                  showLineEndpoints={showLineEndpoints}
                  showLines={showLines}
                  showRejectedEdges={showRejectedEdges}
                  showSelectedEdges={showSelectedEdges}
                  showSharedCarriers={showSharedCarriers}
                  showUndecidedEdges={showUndecidedEdges}
                  stage={stage}
                />
              ) : hasArrangement(stage) ? (
                <ArrangementViewer
                  backgroundMap={backgroundMap}
                  showInferredCrossings={showInferredCrossings}
                  showAtomicEdges={showAtomicEdges}
                  showContacts={showContacts}
                  showJunctions={showJunctions}
                  showLineEndpoints={showLineEndpoints}
                  showLines={showLines}
                  showSharedCarriers={showSharedCarriers}
                  stage={stage}
                />
              ) : stage ? (
                <PrimitiveViewer
                  backgroundMap={backgroundMap}
                  showContacts={showContacts}
                  showJunctions={showJunctions}
                  showLines={showLines}
                  stage={stage}
                />
              ) : (
                <div className="loading-panel">Loading dense evidence...</div>
              )}
            </div>

            <aside className="map-panel">
              <PanelTitle icon={<Layers3 size={17} />} title="Dense Evidence Maps" />
              <select value={selectedMapId} onChange={(event) => setSelectedMapId(event.target.value)}>
                {stage?.maps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.label}
                  </option>
                ))}
              </select>
              {selectedMap ? <Heatmap map={selectedMap} mode="large" /> : <div className="loading-panel">No map loaded.</div>}
              <div className="map-grid">
                {stage?.maps.map((map) => (
                  <button
                    className={map.id === selectedMapId ? 'map-thumb selected' : 'map-thumb'}
                    key={map.id}
                    onClick={() => setSelectedMapId(map.id)}
                    title={map.label}
                  >
                    <Heatmap map={map} mode="thumb" />
                    <span>{map.label}</span>
                  </button>
                ))}
              </div>
              {isStage3(stage) ? <Stage3LayerSummary stage={stage} /> : hasArrangement(stage) ? <Stage2LayerSummary stage={stage} /> : null}
            </aside>
          </section>
        </section>
      </main>
    </div>
  );
}

function hasArrangement(stage: Stage1Response | Stage2Response | Stage3Response | null): stage is Stage2Response | Stage3Response {
  return Boolean(stage && 'arrangement' in stage);
}

function isStage3(stage: Stage1Response | Stage2Response | Stage3Response | null): stage is Stage3Response {
  return Boolean(stage && 'selection' in stage);
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PrimitiveViewer({
  backgroundMap,
  showContacts,
  showJunctions,
  showLines,
  stage,
}: {
  backgroundMap: MapPayload | null;
  showContacts: boolean;
  showJunctions: boolean;
  showLines: boolean;
  stage: Stage1Response;
}) {
  const size = stage.config.image_size;
  return (
    <div className="viewer-canvas">
      {backgroundMap ? (
        <Heatmap map={backgroundMap} mode="background" />
      ) : (
        <img alt="" className="input-image" src={stage.sample.input_image_url} />
      )}
      <svg className="primitive-overlay" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Stage 1 primitives">
        {showLines
          ? stage.primitives.line_primitives.map((line, index) => <LinePrimitiveView key={index} line={line} />)
          : null}
        {showJunctions
          ? stage.primitives.junction_primitives.map((junction, index) => (
              <JunctionView key={index} junction={junction} />
            ))
          : null}
        {showContacts
          ? stage.primitives.boundary_contact_primitives.map((contact, index) => (
              <BoundaryContactView contact={contact} key={index} />
            ))
          : null}
      </svg>
    </div>
  );
}

function LinePrimitiveView({ line }: { line: LinePrimitive }) {
  const label = ASSIGNMENT_LABELS[line.assignment.label] ?? 'U';
  const color = label === 'M' ? '#e11d48' : label === 'V' ? '#2563eb' : label === 'B' ? '#111827' : '#b45309';
  const opacity = line.source === 'observed_strong' ? 0.92 : 0.45;
  return (
    <g>
      <line
        stroke={color}
        strokeLinecap="round"
        strokeOpacity={opacity}
        strokeWidth={line.source === 'observed_strong' ? 3.2 : 2.2}
        x1={line.p0[0]}
        x2={line.p1[0]}
        y1={line.p0[1]}
        y2={line.p1[1]}
      />
      <title>
        {label} support {line.support.toFixed(3)} confidence {line.assignment.confidence.toFixed(3)} votes {line.votes}
      </title>
    </g>
  );
}

function JunctionView({ junction }: { junction: JunctionPrimitive }) {
  return (
    <circle cx={junction.point[0]} cy={junction.point[1]} fill="#facc15" r={5.5} stroke="#422006" strokeWidth={1.5}>
      <title>junction support {junction.support.toFixed(3)}</title>
    </circle>
  );
}

function BoundaryContactView({ contact }: { contact: BoundaryContactPrimitive }) {
  return (
    <circle cx={contact.point[0]} cy={contact.point[1]} fill="#22c55e" r={7} stroke="#064e3b" strokeWidth={1.7}>
      <title>
        {contact.side} contact {contact.side_coordinate.toFixed(3)} support {contact.support.toFixed(3)}
      </title>
    </circle>
  );
}

function ArrangementViewer({
  backgroundMap,
  showAtomicEdges,
  showContacts,
  showInferredCrossings,
  showJunctions,
  showLineEndpoints,
  showLines,
  showSharedCarriers,
  stage,
}: {
  backgroundMap: MapPayload | null;
  showAtomicEdges: boolean;
  showContacts: boolean;
  showInferredCrossings: boolean;
  showJunctions: boolean;
  showLineEndpoints: boolean;
  showLines: boolean;
  showSharedCarriers: boolean;
  stage: Stage2Response;
}) {
  const verticesById = useMemo(() => {
    const values = new Map<number, ArrangementVertex>();
    for (const vertex of stage.arrangement.vertices) values.set(vertex.id, vertex);
    return values;
  }, [stage.arrangement.vertices]);
  const renderedAtomicEdges = stage.arrangement.atomic_edges.slice(0, 5000);
  const clippedAtomicEdges = stage.arrangement.atomic_edges.length - renderedAtomicEdges.length;
  const size = stage.config.image_size;

  return (
    <div className="viewer-canvas">
      {backgroundMap ? (
        <Heatmap map={backgroundMap} mode="background" />
      ) : (
        <img alt="" className="input-image" src={stage.sample.input_image_url} />
      )}
      <svg
        className="primitive-overlay arrangement-overlay"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Stage 2 candidate arrangement"
      >
        {showAtomicEdges
          ? renderedAtomicEdges.map((edge) => (
              <AtomicEdgeView edge={edge} frame={stage.overlay_frame_px} key={edge.id} verticesById={verticesById} />
            ))
          : null}
        {showLines
          ? stage.arrangement.carriers
              .filter((carrier) => carrier.kind === 'observed_local')
              .map((carrier) => <CarrierView carrier={carrier} frame={stage.overlay_frame_px} key={carrier.id} muted />)
          : null}
        {showSharedCarriers
          ? stage.arrangement.carriers
              .filter((carrier) => carrier.kind === 'shared_collinear_alternative')
              .map((carrier) => <CarrierView carrier={carrier} frame={stage.overlay_frame_px} key={carrier.id} muted shared />)
          : null}
        {showJunctions
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'observed_junction' || vertex.kind === 'junction_cluster')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={vertex.id} vertex={vertex} />)
          : null}
        {showLineEndpoints
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'observed_line_endpoint')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={vertex.id} vertex={vertex} />)
          : null}
        {showInferredCrossings
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'carrier_intersection')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={vertex.id} vertex={vertex} />)
          : null}
        {showContacts
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'boundary_contact' || vertex.kind === 'corner')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={`contact-${vertex.id}`} vertex={vertex} />)
          : null}
      </svg>
      {clippedAtomicEdges > 0 ? (
        <div className="render-cap-note">showing first 5000 atomic intervals; {clippedAtomicEdges} hidden for speed</div>
      ) : null}
    </div>
  );
}

function SelectionViewer({
  backgroundMap,
  showCarrierGeometry,
  showContacts,
  showJunctions,
  showLineEndpoints,
  showLines,
  showRejectedEdges,
  showSelectedEdges,
  showSharedCarriers,
  showUndecidedEdges,
  stage,
}: {
  backgroundMap: MapPayload | null;
  showCarrierGeometry: boolean;
  showContacts: boolean;
  showJunctions: boolean;
  showLineEndpoints: boolean;
  showLines: boolean;
  showRejectedEdges: boolean;
  showSelectedEdges: boolean;
  showSharedCarriers: boolean;
  showUndecidedEdges: boolean;
  stage: Stage3Response;
}) {
  const verticesById = useMemo(() => {
    const values = new Map<number, ArrangementVertex>();
    for (const vertex of stage.arrangement.vertices) values.set(vertex.id, vertex);
    return values;
  }, [stage.arrangement.vertices]);
  const edgesById = useMemo(() => {
    const values = new Map<number, ArrangementAtomicEdge>();
    for (const edge of stage.arrangement.atomic_edges) values.set(edge.id, edge);
    return values;
  }, [stage.arrangement.atomic_edges]);
  const carriersById = useMemo(() => {
    const values = new Map<number, ArrangementCarrier>();
    for (const carrier of stage.arrangement.carriers) values.set(carrier.id, carrier);
    return values;
  }, [stage.arrangement.carriers]);
  const scoresByEdgeId = useMemo(() => {
    const values = new Map<number, Stage3Response['selection']['edge_scores'][number]>();
    for (const score of stage.selection.edge_scores) values.set(score.edge_id, score);
    return values;
  }, [stage.selection.edge_scores]);
  const size = stage.config.image_size;

  const renderSelectionEdges = (ids: number[], decision: 'selected' | 'rejected' | 'undecided') =>
    ids
      .slice(0, decision === 'selected' ? 5000 : 1500)
      .map((edgeId) => {
        const edge = edgesById.get(edgeId);
        const score = scoresByEdgeId.get(edgeId);
        if (!edge || !score) return null;
        return (
          <SelectionEdgeView
            decision={decision}
            edge={edge}
            frame={stage.overlay_frame_px}
            key={`${decision}-${edgeId}`}
            score={score}
            carriersById={carriersById}
            showCarrierGeometry={showCarrierGeometry}
            verticesById={verticesById}
          />
        );
      });

  return (
    <div className="viewer-canvas">
      {backgroundMap ? (
        <Heatmap map={backgroundMap} mode="background" />
      ) : (
        <img alt="" className="input-image" src={stage.sample.input_image_url} />
      )}
      <svg
        className="primitive-overlay arrangement-overlay"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Stage 3 weighted selection"
      >
        {showRejectedEdges ? renderSelectionEdges(stage.selection.rejected_edge_ids, 'rejected') : null}
        {showUndecidedEdges ? renderSelectionEdges(stage.selection.undecided_edge_ids, 'undecided') : null}
        {showLines
          ? stage.arrangement.carriers
              .filter((carrier) => carrier.kind === 'observed_local')
              .map((carrier) => <CarrierView carrier={carrier} frame={stage.overlay_frame_px} key={carrier.id} muted />)
          : null}
        {showSharedCarriers
          ? stage.arrangement.carriers
              .filter((carrier) => carrier.kind === 'shared_collinear_alternative')
              .map((carrier) => <CarrierView carrier={carrier} frame={stage.overlay_frame_px} key={carrier.id} muted shared />)
          : null}
        {showSelectedEdges ? renderSelectionEdges(stage.selection.selected_edge_ids, 'selected') : null}
        {showJunctions
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'observed_junction' || vertex.kind === 'junction_cluster')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={vertex.id} vertex={vertex} />)
          : null}
        {showLineEndpoints
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'observed_line_endpoint')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={vertex.id} vertex={vertex} />)
          : null}
        {showContacts
          ? stage.arrangement.vertices
              .filter((vertex) => vertex.kind === 'boundary_contact' || vertex.kind === 'corner')
              .map((vertex) => <ArrangementVertexView frame={stage.overlay_frame_px} key={`contact-${vertex.id}`} vertex={vertex} />)
          : null}
      </svg>
    </div>
  );
}

function SelectionEdgeView({
  carriersById,
  decision,
  edge,
  frame,
  score,
  showCarrierGeometry,
  verticesById,
}: {
  carriersById: Map<number, ArrangementCarrier>;
  decision: 'selected' | 'rejected' | 'undecided';
  edge: ArrangementAtomicEdge;
  frame: Stage2Response['overlay_frame_px'];
  score: Stage3Response['selection']['edge_scores'][number];
  showCarrierGeometry: boolean;
  verticesById: Map<number, ArrangementVertex>;
}) {
  const a = verticesById.get(edge.vertices[0]);
  const b = verticesById.get(edge.vertices[1]);
  if (!a || !b) return null;
  const carrier = carriersById.get(edge.carrier_id);
  const p0 =
    showCarrierGeometry && carrier
      ? imagePoint(pointAtCarrierT(carrier, edge.t_interval[0]), frame)
      : imagePoint(a.point, frame);
  const p1 =
    showCarrierGeometry && carrier
      ? imagePoint(pointAtCarrierT(carrier, edge.t_interval[1]), frame)
      : imagePoint(b.point, frame);
  const color =
    decision === 'selected'
      ? arrangementAssignmentColor(edge.assignment.label)
      : decision === 'undecided'
        ? '#f59e0b'
        : '#94a3b8';
  return (
    <line
      stroke={color}
      strokeDasharray={decision === 'selected' ? undefined : decision === 'undecided' ? '7 5' : '3 7'}
      strokeLinecap="round"
      strokeOpacity={decision === 'selected' ? 0.96 : decision === 'undecided' ? 0.62 : 0.24}
      strokeWidth={decision === 'selected' ? 3.1 : 1.5}
      vectorEffect="non-scaling-stroke"
      x1={p0.x}
      x2={p1.x}
      y1={p0.y}
      y2={p1.y}
    >
      <title>
        {decision} edge {edge.id} carrier {edge.carrier_id} {carrier?.kind ?? 'unknown'} score {score.total_score.toFixed(3)} support{' '}
        {edge.line_support.toFixed(3)}; {score.reasons.join('; ')}
      </title>
    </line>
  );
}

function CarrierView({
  carrier,
  frame,
  muted = false,
  shared = false,
}: {
  carrier: ArrangementCarrier;
  frame: Stage2Response['overlay_frame_px'];
  muted?: boolean;
  shared?: boolean;
}) {
  const p0 = imagePoint(pointAtCarrierT(carrier, carrier.support_interval[0]), frame);
  const p1 = imagePoint(pointAtCarrierT(carrier, carrier.support_interval[1]), frame);
  const color = muted ? (shared ? '#7c3aed' : '#475569') : shared ? '#9333ea' : arrangementAssignmentColor(carrier.assignment.label);
  return (
    <line
      stroke={color}
      strokeDasharray={shared ? '7 5' : undefined}
      strokeLinecap="round"
      strokeOpacity={muted ? 0.24 : shared ? 0.82 : carrier.source === 'observed_strong' ? 0.9 : 0.55}
      strokeWidth={muted ? 1.2 : shared ? 2.4 : 2.1}
      vectorEffect="non-scaling-stroke"
      x1={p0.x}
      x2={p1.x}
      y1={p0.y}
      y2={p1.y}
    >
      <title>
        {carrier.kind} support {carrier.visual_support.toFixed(3)} cost {carrier.hypothesis_cost.toFixed(3)}
      </title>
    </line>
  );
}

function AtomicEdgeView({
  edge,
  frame,
  verticesById,
}: {
  edge: ArrangementAtomicEdge;
  frame: Stage2Response['overlay_frame_px'];
  verticesById: Map<number, ArrangementVertex>;
}) {
  const a = verticesById.get(edge.vertices[0]);
  const b = verticesById.get(edge.vertices[1]);
  if (!a || !b) return null;
  const p0 = imagePoint(a.point, frame);
  const p1 = imagePoint(b.point, frame);
  return (
    <line
      stroke="#f59e0b"
      strokeLinecap="round"
      strokeOpacity={0.22 + Math.min(0.38, edge.line_support * 0.38)}
      strokeWidth={1.2}
      vectorEffect="non-scaling-stroke"
      x1={p0.x}
      x2={p1.x}
      y1={p0.y}
      y2={p1.y}
    >
      <title>
        atomic interval {edge.id} carrier {edge.carrier_id} support {edge.line_support.toFixed(3)} overlap{' '}
        {edge.support_overlap.toFixed(3)}
      </title>
    </line>
  );
}

function ArrangementVertexView({
  frame,
  vertex,
}: {
  frame: Stage2Response['overlay_frame_px'];
  vertex: ArrangementVertex;
}) {
  const color =
    vertex.kind === 'corner'
      ? '#111827'
      : vertex.kind === 'boundary_contact'
        ? '#22c55e'
        : vertex.kind === 'observed_junction'
          ? '#facc15'
          : vertex.kind === 'junction_cluster'
            ? '#06b6d4'
            : vertex.kind === 'carrier_intersection'
              ? '#f97316'
              : '#94a3b8';
  const point = imagePoint(vertex.point, frame);
  const radius = vertex.kind === 'corner' || vertex.kind === 'boundary_contact' ? 7 : 5;
  return (
    <circle
      cx={point.x}
      cy={point.y}
      fill={color}
      r={radius}
      stroke="#0f172a"
      strokeOpacity={0.75}
      strokeWidth={1.1}
      vectorEffect="non-scaling-stroke"
    >
      <title>
        {vertex.kind} support {vertex.support.toFixed(3)} carriers {vertex.carrier_ids.join(',') || 'none'}
      </title>
    </circle>
  );
}

function Stage2LayerSummary({ stage }: { stage: Stage2Response }) {
  const counts = stage.arrangement.hypotheses.reduce<Record<string, number>>((acc, hypothesis) => {
    acc[hypothesis.kind] = (acc[hypothesis.kind] ?? 0) + 1;
    return acc;
  }, {});
  const report = stage.arrangement.report;
  return (
    <div className="hypothesis-panel">
      <PanelTitle icon={<GitBranch size={17} />} title="Stage 2 Layers" />
      <LayerRow color="#e11d48" label="Observed carriers" value={report.observed_carriers} note="line evidence from the dense model" />
      <LayerRow color="#9333ea" label="Shared alternatives" value={report.shared_carrier_alternatives} note="optional collinear carrier interpretations" />
      <LayerRow color="#facc15" label="Observed junctions" value={report.observed_junctions} note="model junction peaks" />
      <LayerRow color="#94a3b8" label="Line endpoints" value={report.line_endpoints} note="ends of observed line primitives" />
      <LayerRow color="#22c55e" label="Boundary contacts" value={report.boundary_contacts} note="square-side contact candidates" />
      <LayerRow color="#f97316" label="Inferred crossings" value={report.carrier_intersections} note="supported carrier-carrier crossings" />
      <LayerRow
        color="#64748b"
        label="Suppressed crossings"
        value={report.suppressed_carrier_intersections}
        note="infinite-line crossings outside observed support"
      />
      <LayerRow color="#f59e0b" label="Atomic intervals" value={report.atomic_edges} note="adjacent candidate vertex intervals; not selected" />
      <div className="hypothesis-divider" />
      <PanelTitle icon={<GitBranch size={17} />} title="Hypotheses" />
      {Object.entries(counts).map(([kind, count]) => (
        <div className="hypothesis-row" key={kind}>
          <span>{kind.replaceAll('_', ' ')}</span>
          <strong>{count}</strong>
        </div>
      ))}
      <p>Stage 2 keeps alternatives open. It emits {report.selected_edges} selected FOLD edges by design.</p>
    </div>
  );
}

function Stage3LayerSummary({ stage }: { stage: Stage3Response }) {
  const report = stage.selection.report;
  const carriersById = new Map(stage.arrangement.carriers.map((carrier) => [carrier.id, carrier]));
  const selectedScores = stage.selection.edge_scores.filter((score) => score.decision === 'selected');
  const selectedCarrierIds = new Set(selectedScores.map((score) => score.carrier_id));
  const selectedSharedEdges = selectedScores.filter(
    (score) => carriersById.get(score.carrier_id)?.kind === 'shared_collinear_alternative',
  ).length;
  const selectedObservedEdges = selectedScores.filter(
    (score) => carriersById.get(score.carrier_id)?.kind === 'observed_local',
  ).length;
  const selectedSharedCarriers = Array.from(selectedCarrierIds).filter(
    (carrierId) => carriersById.get(carrierId)?.kind === 'shared_collinear_alternative',
  ).length;
  const topSelectedScores = selectedScores
    .filter((score) => score.decision === 'selected')
    .sort((left, right) => right.total_score - left.total_score)
    .slice(0, 10);
  return (
    <div className="hypothesis-panel">
      <PanelTitle icon={<GitBranch size={17} />} title="Stage 3 Selection" />
      <LayerRow color="#16a34a" label="Selected edges" value={report.selected_edges} note="atomic intervals chosen for the graph" />
      <LayerRow color="#9333ea" label="Shared selected" value={selectedSharedEdges} note="selected intervals from shared straight carriers" />
      <LayerRow color="#475569" label="Observed selected" value={selectedObservedEdges} note="selected intervals from local observed carriers" />
      <LayerRow color="#0f766e" label="Selected carriers" value={selectedCarrierIds.size} note={`${selectedSharedCarriers} shared carrier(s) selected`} />
      <LayerRow color="#f59e0b" label="Undecided edges" value={report.undecided_edges} note="plausible evidence not selected yet" />
      <LayerRow color="#94a3b8" label="Rejected edges" value={report.rejected_edges} note="candidates below current costs" />
      <LayerRow color="#2563eb" label="Weak promoted" value={report.weak_edges_promoted} note="weak evidence selected by topology benefit" />
      <LayerRow color="#9333ea" label="Hypotheses" value={report.selected_hypotheses} note="arrangement hypotheses referenced by selection" />
      <LayerRow color="#ef4444" label="Odd vertices" value={report.odd_degree_vertices} note="remaining local topology warnings" />
      <div className="hypothesis-divider" />
      <div className="selection-status-row">
        <span>Total selected score</span>
        <strong>{report.total_score.toFixed(2)}</strong>
      </div>
      <div className="selection-status-row">
        <span>Exactizability probes</span>
        <strong>{report.exactizability_evaluated ? 'evaluated' : 'phase 4'}</strong>
      </div>
      <div className="selection-status-row">
        <span>Emits FOLD graph</span>
        <strong>{report.emits_fold_graph ? 'yes' : 'no'}</strong>
      </div>
      <div className="hypothesis-divider" />
      <PanelTitle icon={<GitBranch size={17} />} title="Accepted Edge Scores" />
      {topSelectedScores.map((score) => (
        <div className="score-row" key={score.edge_id}>
          <strong>edge {score.edge_id}</strong>
          <span>{score.total_score.toFixed(2)}</span>
          <em>{score.reasons[0] ?? 'selected'}</em>
        </div>
      ))}
      <p>
        Stage 3 shows the selected graph candidate by default. Turn on observed carriers or shared alternatives only when
        comparing the choice against Stage 2 evidence. Exact geometric theorem costs arrive in Phase 4.
      </p>
    </div>
  );
}

function LayerRow({ color, label, note, value }: { color: string; label: string; note: string; value: number }) {
  return (
    <div className="layer-row">
      <span className="layer-swatch" style={{ background: color }} />
      <span>
        <strong>{label}</strong>
        <em>{note}</em>
      </span>
      <b>{value}</b>
    </div>
  );
}

function pointAtCarrierT(carrier: ArrangementCarrier, t: number) {
  return {
    x: carrier.normal.x * carrier.rho + carrier.direction.x * t,
    y: carrier.normal.y * carrier.rho + carrier.direction.y * t,
  };
}

function imagePoint(point: { x: number; y: number }, frame: Stage2Response['overlay_frame_px']) {
  return {
    x: frame.x_min + point.x * (frame.x_max - frame.x_min),
    y: frame.y_min + point.y * (frame.y_max - frame.y_min),
  };
}

function arrangementAssignmentColor(label: string) {
  if (label === 'mountain') return '#e11d48';
  if (label === 'valley') return '#2563eb';
  if (label === 'boundary') return '#111827';
  return '#64748b';
}

function Heatmap({ map, mode }: { map: MapPayload; mode: 'thumb' | 'large' | 'background' }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = map.width;
    canvas.height = map.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(map.width, map.height);
    for (let index = 0; index < map.values.length; index += 1) {
      const value = map.values[index] ?? 0;
      const offset = index * 4;
      const [red, green, blue] = heatColor(value / 255);
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = mode === 'background' ? 210 : 255;
    }
    context.putImageData(image, 0, 0);
    setDataUrl(canvas.toDataURL('image/png'));
  }, [map, mode]);

  return (
    <img
      alt=""
      className={mode === 'thumb' ? 'heatmap thumb' : mode === 'background' ? 'heatmap background' : 'heatmap large'}
      src={dataUrl || undefined}
    />
  );
}

function heatColor(value: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped < 0.33) {
    const t = clamped / 0.33;
    return [Math.round(20 + t * 20), Math.round(35 + t * 105), Math.round(70 + t * 135)];
  }
  if (clamped < 0.66) {
    const t = (clamped - 0.33) / 0.33;
    return [Math.round(40 + t * 215), Math.round(140 + t * 70), Math.round(205 - t * 145)];
  }
  const t = (clamped - 0.66) / 0.34;
  return [255, Math.round(210 - t * 70), Math.round(60 - t * 40)];
}
