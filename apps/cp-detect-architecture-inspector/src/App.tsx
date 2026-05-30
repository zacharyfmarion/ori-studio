import { useEffect, useMemo, useState } from 'react';
import { Activity, CircleDot, GitBranch, Layers3, ListFilter, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { fetchStage1Example, fetchStage1Examples, fetchStage2Example, fetchStage3Example, fetchStage4Example, fetchStage5Example, fetchStages } from './api';
import type {
  ArrangementAtomicEdge,
  ArrangementCarrier,
  ArrangementVertex,
  BoundaryExactizabilityProbe,
  BoundaryContactPrimitive,
  CarrierExactizabilityProbe,
  ExampleRow,
  GroundTruthGraph,
  JunctionPrimitive,
  LinePrimitive,
  MapPayload,
  Stage1Response,
  Stage2Response,
  Stage3Response,
  Stage4Response,
  Stage5Response,
  VertexExactizabilityProbe,
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

type ProbeKindId = 'vertex' | 'carrier' | 'boundary';
type ProbeStatusId = 'feasible' | 'low_cost' | 'high_cost' | 'infeasible' | 'odd_degree' | 'hard_kawasaki';
type ProbeVisibility = Record<ProbeStatusId, Record<ProbeKindId, boolean>>;
type Stage4IssueFilter = 'all' | 'hard_kawasaki' | 'odd_degree' | 'infeasible' | 'high_cost' | 'vertex' | 'carrier' | 'boundary';

interface Stage4Issue {
  id: string;
  probeKind: ProbeKindId;
  status: ProbeStatusId;
  label: string;
  summary: string;
  detail: string;
  value: number;
  valueLabel: string;
  color: string;
  vertexId?: number;
  carrierId?: number;
  side?: string | null;
  point?: { x: number; y: number };
  selectedEdgeIds: number[];
  candidateEdgeIds: number[];
  carrierIds: number[];
  blockers: string[];
  degree?: number;
  residualDegrees?: number | null;
  maxMove?: number;
  rayAngles?: number[];
  sectorAngles?: number[];
}

interface Stage4IssueSection {
  id: Stage4IssueFilter;
  label: string;
  issues: Stage4Issue[];
  total: number;
}

const PROBE_KIND_LABELS: Record<ProbeKindId, string> = {
  vertex: 'V',
  carrier: 'C',
  boundary: 'B',
};

const PROBE_STATUS_ROWS: Array<{
  id: ProbeStatusId;
  label: string;
  note: string;
  color: string;
  kinds: ProbeKindId[];
}> = [
  { id: 'feasible', label: 'Feasible', note: 'already locally exact', color: '#16a34a', kinds: ['vertex', 'carrier', 'boundary'] },
  { id: 'low_cost', label: 'Low cost', note: 'small movement should fix local geometry', color: '#0891b2', kinds: ['vertex', 'carrier', 'boundary'] },
  { id: 'high_cost', label: 'High cost', note: 'possible but expensive or evidence-moving', color: '#f59e0b', kinds: ['vertex', 'carrier', 'boundary'] },
  { id: 'infeasible', label: 'Infeasible', note: 'topology or movement budget blocker', color: '#dc2626', kinds: ['vertex', 'carrier', 'boundary'] },
  { id: 'odd_degree', label: 'Odd vertices', note: 'geometry cannot repair odd degree', color: '#ef4444', kinds: ['vertex'] },
  { id: 'hard_kawasaki', label: 'Hard Kawasaki', note: 'large local angle residuals', color: '#9333ea', kinds: ['vertex'] },
];

const ISSUE_FILTERS: Array<{ id: Stage4IssueFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'hard_kawasaki', label: 'Kawasaki' },
  { id: 'odd_degree', label: 'Odd' },
  { id: 'infeasible', label: 'Infeasible' },
  { id: 'high_cost', label: 'High cost' },
  { id: 'vertex', label: 'Vertex' },
  { id: 'carrier', label: 'Carrier' },
  { id: 'boundary', label: 'Boundary' },
];

const ISSUE_LIST_LIMIT_PER_TYPE = 10;

function defaultProbeVisibility(): ProbeVisibility {
  return {
    feasible: { vertex: false, carrier: false, boundary: false },
    low_cost: { vertex: false, carrier: false, boundary: false },
    high_cost: { vertex: true, carrier: true, boundary: true },
    infeasible: { vertex: true, carrier: true, boundary: true },
    odd_degree: { vertex: true, carrier: false, boundary: false },
    hard_kawasaki: { vertex: true, carrier: false, boundary: false },
  };
}

export function App() {
  const [serverOk, setServerOk] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<'stage1' | 'stage2' | 'stage3' | 'stage4' | 'stage5'>('stage5');
  const [threshold, setThreshold] = useState(0.65);
  const [mapSize, setMapSize] = useState(192);
  const [stage, setStage] = useState<Stage1Response | Stage2Response | Stage3Response | Stage4Response | Stage5Response | null>(null);
  const [loadingStage, setLoadingStage] = useState(false);
  const [background, setBackground] = useState('input');
  const [showLines, setShowLines] = useState(true);
  const [showJunctions, setShowJunctions] = useState(true);
  const [showContacts, setShowContacts] = useState(true);
  const [showLineEndpoints, setShowLineEndpoints] = useState(false);
  const [showInferredCrossings, setShowInferredCrossings] = useState(false);
  const [showSharedCarriers, setShowSharedCarriers] = useState(true);
  const [showAtomicEdges, setShowAtomicEdges] = useState(false);
  const [showSelectedEdges, setShowSelectedEdges] = useState(true);
  const [showRejectedEdges, setShowRejectedEdges] = useState(false);
  const [showUndecidedEdges, setShowUndecidedEdges] = useState(false);
  const [showCarrierGeometry, setShowCarrierGeometry] = useState(true);
  const [showGroundTruth, setShowGroundTruth] = useState(true);
  const [probeVisibility, setProbeVisibility] = useState<ProbeVisibility>(() => defaultProbeVisibility());
  const [stage4IssueFilter, setStage4IssueFilter] = useState<Stage4IssueFilter>('all');
  const [selectedStage4IssueId, setSelectedStage4IssueId] = useState<string | null>(null);
  const [selectedMapId, setSelectedMapId] = useState('line_probability');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (activeStage === 'stage5') {
      setShowLines(false);
      setShowSharedCarriers(false);
      setShowAtomicEdges(false);
      setShowSelectedEdges(true);
      setShowUndecidedEdges(false);
      setShowRejectedEdges(false);
      setShowJunctions(false);
      setShowContacts(false);
      setShowLineEndpoints(false);
      setShowInferredCrossings(false);
      setShowCarrierGeometry(true);
      setShowGroundTruth(true);
    } else if (activeStage === 'stage4') {
      setShowLines(false);
      setShowSharedCarriers(false);
      setShowAtomicEdges(false);
      setShowSelectedEdges(false);
      setShowUndecidedEdges(false);
      setShowRejectedEdges(false);
      setShowJunctions(false);
      setShowContacts(false);
      setShowLineEndpoints(false);
      setShowInferredCrossings(false);
      setShowCarrierGeometry(true);
      setShowGroundTruth(false);
      setProbeVisibility(defaultProbeVisibility());
    } else if (activeStage === 'stage3') {
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
      setShowGroundTruth(false);
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
      setShowGroundTruth(false);
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
      setShowGroundTruth(false);
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
      activeStage === 'stage5'
        ? fetchStage5Example(selectedId, { threshold, mapSize })
        : activeStage === 'stage4'
        ? fetchStage4Example(selectedId, { threshold, mapSize })
        : activeStage === 'stage3'
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

  const stage4Issues = useMemo(() => (activeStage === 'stage4' && isStage4(stage) ? buildStage4Issues(stage) : []), [activeStage, stage]);
  const filteredStage4Issues = useMemo(
    () => filterStage4Issues(stage4Issues, stage4IssueFilter),
    [stage4IssueFilter, stage4Issues],
  );
  const selectedStage4Issue = useMemo(
    () => filteredStage4Issues.find((issue) => issue.id === selectedStage4IssueId) ?? null,
    [filteredStage4Issues, selectedStage4IssueId],
  );

  useEffect(() => {
    if (activeStage !== 'stage4') {
      setSelectedStage4IssueId(null);
      return;
    }
    setSelectedStage4IssueId((current) =>
      current && filteredStage4Issues.some((issue) => issue.id === current) ? current : (filteredStage4Issues[0]?.id ?? null),
    );
  }, [activeStage, filteredStage4Issues]);

  const toggleProbeVisibility = (status: ProbeStatusId, kind: ProbeKindId) => {
    setProbeVisibility((current) => ({
      ...current,
      [status]: {
        ...current[status],
        [kind]: !current[status][kind],
      },
    }));
  };

  const selectStage4Issue = (issue: Stage4Issue) => {
    setSelectedStage4IssueId(issue.id);
    setProbeVisibility((current) => ({
      ...current,
      [issue.status]: {
        ...current[issue.status],
        [issue.probeKind]: true,
      },
    }));
  };

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
              <select value={activeStage} onChange={(event) => setActiveStage(event.target.value as 'stage1' | 'stage2' | 'stage3' | 'stage4' | 'stage5')}>
                <option value="stage1">Stage 1: dense evidence</option>
                <option value="stage2">Stage 2: candidate arrangement</option>
                <option value="stage3">Stage 3: weighted selection</option>
                <option value="stage4">Stage 4: exactizability probes</option>
                <option value="stage5">Stage 5: beam selection</option>
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
            {activeStage !== 'stage4' && activeStage !== 'stage5' ? (
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
            ) : null}
            {activeStage !== 'stage4' && activeStage !== 'stage5' ? (
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
            ) : null}
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

          {activeStage === 'stage5' ? (
            <section className="summary-grid">
              <Metric label="selected spans" value={isStage5(stage) ? stage.selection.report.selected_spans : '...'} />
              <Metric
                label="span vertices"
                value={isStage5(stage) ? new Set(stage.selection.selected_spans.flatMap((span) => span.vertices)).size : '...'}
              />
              <Metric label="atomic provenance" value={isStage5(stage) ? stage.selection.selected_edge_ids.length : '...'} />
              <Metric
                label="shared spans"
                value={isStage5(stage) ? stage.selection.selected_spans.filter((span) => span.kind === 'shared_carrier_span').length : '...'}
              />
              <Metric
                label="collapsed vertices"
                value={isStage5(stage) ? stage.selection.selected_spans.reduce((sum, span) => sum + span.collapsed_vertex_ids.length, 0) : '...'}
              />
              <Metric label="weak promoted" value={isStage5(stage) ? stage.selection.report.weak_edges_promoted : '...'} />
              <Metric
                label="GT graph"
                value={isStage5(stage) && stage.ground_truth ? `${stage.ground_truth.vertices_px.length} V / ${stage.ground_truth.edges_vertices.length} E` : 'none'}
              />
            </section>
          ) : activeStage === 'stage4' ? (
            <section className="summary-grid">
              <Metric label="probe verdicts" value={isStage4(stage) ? `${stage.exactizability.summary.infeasible} hard / ${stage.exactizability.summary.high_cost} high` : '...'} />
              <Metric label="odd vertices" value={isStage4(stage) ? stage.exactizability.summary.odd_degree_vertices : '...'} />
              <Metric
                label="max Kawasaki"
                value={isStage4(stage) ? `${stage.exactizability.summary.max_kawasaki_residual_degrees.toFixed(1)}°` : '...'}
              />
              <Metric
                label="max vertex move"
                value={isStage4(stage) ? stage.exactizability.summary.max_estimated_vertex_move.toFixed(4) : '...'}
              />
              <Metric
                label="max carrier move"
                value={isStage4(stage) ? stage.exactizability.summary.max_carrier_endpoint_move.toFixed(4) : '...'}
              />
            </section>
          ) : activeStage === 'stage3' ? (
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

          <section
            className={
              activeStage === 'stage4'
                ? 'viewer-and-maps stage4-viewer-layout'
                : activeStage === 'stage5'
                  ? 'viewer-and-maps stage5-viewer-layout'
                  : 'viewer-and-maps'
            }
          >
            <div className="viewer-panel">
              <div className="viewer-toolbar">
                <PanelTitle
                  icon={activeStage !== 'stage1' ? <GitBranch size={17} /> : <Layers3 size={17} />}
                  title={
                    activeStage === 'stage5'
                      ? 'Selected Graph vs Ground Truth'
                      : activeStage === 'stage4'
                      ? 'Input + Exactizability Probes'
                      : activeStage === 'stage3'
                      ? 'Input + Weighted Selection'
                      : activeStage === 'stage2'
                        ? 'Input + Candidate Arrangement'
                        : 'Input + Stage 1 Primitives'
                  }
                />
                {activeStage === 'stage5' ? (
                  <div className="toggle-row stage5-toggle-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={showSelectedEdges}
                        onChange={(event) => setShowSelectedEdges(event.target.checked)}
                      />
                      selected graph
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={showGroundTruth}
                        onChange={(event) => setShowGroundTruth(event.target.checked)}
                      />
                      GT graph
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={showAtomicEdges}
                        onChange={(event) => setShowAtomicEdges(event.target.checked)}
                      />
                      atomic provenance
                    </label>
                  </div>
                ) : activeStage !== 'stage4' ? (
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
                ) : null}
              </div>
              {isStage3(stage) ? (
                <SelectionViewer
                  backgroundMap={activeStage === 'stage4' || activeStage === 'stage5' ? null : backgroundMap}
                  showCarrierGeometry={activeStage === 'stage5' ? true : showCarrierGeometry}
                  showContacts={showContacts}
                  showJunctions={showJunctions}
                  showLineEndpoints={showLineEndpoints}
                  showLines={showLines}
                  showExactProbes={activeStage === 'stage4'}
                  showGroundTruth={showGroundTruth}
                  showAtomicEdges={showAtomicEdges}
                  showRejectedEdges={showRejectedEdges}
                  showSelectedEdges={showSelectedEdges}
                  showSharedCarriers={showSharedCarriers}
                  showUndecidedEdges={showUndecidedEdges}
                  probeVisibility={probeVisibility}
                  selectedStage4Issue={selectedStage4Issue}
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

            {isStage4(stage) ? (
              <aside className="map-panel stage4-probe-panel">
                <Stage4LayerSummary
                  filteredIssues={filteredStage4Issues}
                  issueFilter={stage4IssueFilter}
                  issues={stage4Issues}
                  onToggleProbe={toggleProbeVisibility}
                  onIssueFilterChange={setStage4IssueFilter}
                  onSelectIssue={selectStage4Issue}
                  probeVisibility={probeVisibility}
                  selectedIssue={selectedStage4Issue}
                  stage={stage}
                />
              </aside>
            ) : activeStage === 'stage5' ? null : (
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
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function hasArrangement(
  stage: Stage1Response | Stage2Response | Stage3Response | Stage4Response | Stage5Response | null,
): stage is Stage2Response | Stage3Response | Stage4Response | Stage5Response {
  return Boolean(stage && 'arrangement' in stage);
}

function isStage3(
  stage: Stage1Response | Stage2Response | Stage3Response | Stage4Response | Stage5Response | null,
): stage is Stage3Response | Stage4Response | Stage5Response {
  return Boolean(stage && 'selection' in stage);
}

function hasExactizability(
  stage: Stage1Response | Stage2Response | Stage3Response | Stage4Response | Stage5Response | null,
): stage is Stage4Response | Stage5Response {
  return Boolean(stage && 'exactizability' in stage);
}

function isStage4(stage: Stage1Response | Stage2Response | Stage3Response | Stage4Response | Stage5Response | null): stage is Stage4Response {
  return Boolean(stage && 'exactizability' in stage && !('ground_truth' in stage));
}

function isStage5(stage: Stage1Response | Stage2Response | Stage3Response | Stage4Response | Stage5Response | null): stage is Stage5Response {
  return Boolean(stage && 'ground_truth' in stage);
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
  showAtomicEdges,
  showContacts,
  showExactProbes,
  showGroundTruth,
  showJunctions,
  showLineEndpoints,
  showLines,
  probeVisibility,
  showRejectedEdges,
  showSelectedEdges,
  showSharedCarriers,
  showUndecidedEdges,
  selectedStage4Issue,
  stage,
}: {
  backgroundMap: MapPayload | null;
  showCarrierGeometry: boolean;
  showAtomicEdges: boolean;
  showContacts: boolean;
  showExactProbes: boolean;
  showGroundTruth: boolean;
  showJunctions: boolean;
  showLineEndpoints: boolean;
  showLines: boolean;
  probeVisibility: ProbeVisibility;
  showRejectedEdges: boolean;
  showSelectedEdges: boolean;
  showSharedCarriers: boolean;
  showUndecidedEdges: boolean;
  selectedStage4Issue: Stage4Issue | null;
  stage: Stage3Response | Stage4Response | Stage5Response;
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
  const visibleVertexProbes = useMemo(() => {
    if (!showExactProbes || !hasExactizability(stage)) return [];
    return stage.exactizability.vertex_probes
      .map((probe) => ({ probe, displayStatus: vertexProbeDisplayStatus(probe, probeVisibility) }))
      .filter((entry): entry is { probe: VertexExactizabilityProbe; displayStatus: ProbeStatusId } => entry.displayStatus !== null);
  }, [probeVisibility, showExactProbes, stage]);
  const visibleCarrierProbes = useMemo(() => {
    if (!showExactProbes || !hasExactizability(stage)) return [];
    return stage.exactizability.carrier_probes.filter((probe) => isProbeStatusVisible(probe.status, 'carrier', probeVisibility));
  }, [probeVisibility, showExactProbes, stage]);
  const visibleBoundaryProbes = useMemo(() => {
    if (!showExactProbes || !hasExactizability(stage)) return [];
    return stage.exactizability.boundary_probes.filter((probe) => isProbeStatusVisible(probe.status, 'boundary', probeVisibility));
  }, [probeVisibility, showExactProbes, stage]);
  const stage4Active = showExactProbes && hasExactizability(stage);
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
    <div className={stage4Active ? 'viewer-canvas stage4-issue-canvas' : 'viewer-canvas'}>
      {backgroundMap ? (
        <Heatmap map={backgroundMap} mode="background" />
      ) : (
        <img alt="" className={stage4Active ? 'input-image stage4-source-image' : 'input-image'} src={stage.sample.input_image_url} />
      )}
      <svg
        className="primitive-overlay arrangement-overlay"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={stage4Active ? 'Stage 4 exactizability probes' : isStage5(stage) ? 'Stage 5 selected graph' : 'Stage 3 weighted selection'}
      >
        {showGroundTruth && isStage5(stage) && stage.ground_truth ? (
          <GroundTruthGraphView graph={stage.ground_truth} />
        ) : null}
        {showAtomicEdges ? renderSelectionEdges(stage.selection.selected_edge_ids, 'selected') : null}
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
        {showSelectedEdges && isStage5(stage) ? (
          <SelectionSpanGraphView
            carriersById={carriersById}
            frame={stage.overlay_frame_px}
            selection={stage.selection}
            verticesById={verticesById}
          />
        ) : showSelectedEdges ? (
          renderSelectionEdges(stage.selection.selected_edge_ids, 'selected')
        ) : null}
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
        {stage4Active && hasExactizability(stage)
          ? visibleCarrierProbes.map((probe) => {
              const carrier = carriersById.get(probe.carrier_id);
              return carrier ? (
                <ExactCarrierProbeView
                  carrier={carrier}
                  frame={stage.overlay_frame_px}
                  key={`carrier-probe-${probe.carrier_id}`}
                  muted={Boolean(selectedStage4Issue && !stage4IssueMatchesProbe(selectedStage4Issue, 'carrier', probe))}
                  probe={probe}
                  selected={Boolean(selectedStage4Issue && stage4IssueMatchesProbe(selectedStage4Issue, 'carrier', probe))}
                />
              ) : null;
            })
          : null}
        {stage4Active && hasExactizability(stage)
          ? visibleBoundaryProbes.map((probe) => (
              <ExactBoundaryProbeView
                frame={stage.overlay_frame_px}
                key={`boundary-probe-${probe.vertex_id}`}
                muted={Boolean(selectedStage4Issue && !stage4IssueMatchesProbe(selectedStage4Issue, 'boundary', probe))}
                probe={probe}
                selected={Boolean(selectedStage4Issue && stage4IssueMatchesProbe(selectedStage4Issue, 'boundary', probe))}
              />
            ))
          : null}
        {stage4Active && hasExactizability(stage)
          ? visibleVertexProbes.map(({ displayStatus, probe }) => (
              <ExactVertexProbeView
                displayStatus={displayStatus}
                frame={stage.overlay_frame_px}
                key={`vertex-probe-${probe.vertex_id}`}
                muted={Boolean(selectedStage4Issue && !stage4IssueMatchesProbe(selectedStage4Issue, 'vertex', probe, displayStatus))}
                probe={probe}
                selected={Boolean(selectedStage4Issue && stage4IssueMatchesProbe(selectedStage4Issue, 'vertex', probe, displayStatus))}
              />
            ))
          : null}
        {stage4Active && selectedStage4Issue ? (
          <Stage4IssueContextView
            carriersById={carriersById}
            edgesById={edgesById}
            frame={stage.overlay_frame_px}
            issue={selectedStage4Issue}
            scoresByEdgeId={scoresByEdgeId}
            showCarrierGeometry={showCarrierGeometry}
            verticesById={verticesById}
          />
        ) : null}
      </svg>
    </div>
  );
}

function GroundTruthGraphView({ graph }: { graph: GroundTruthGraph }) {
  return (
    <g className="ground-truth-graph" aria-label="Ground truth graph">
      {graph.edges_vertices.map(([aId, bId], index) => {
        const a = graph.vertices_px[aId];
        const b = graph.vertices_px[bId];
        if (!a || !b) return null;
        const label = graph.edges_assignment_labels[index] ?? 'U';
        return (
          <line
            key={`gt-${index}`}
            stroke={groundTruthAssignmentColor(label)}
            strokeLinecap="round"
            strokeOpacity={label === 'B' ? 0.5 : 0.38}
            strokeWidth={label === 'B' ? 2.0 : 1.35}
            vectorEffect="non-scaling-stroke"
            x1={a[0]}
            x2={b[0]}
            y1={a[1]}
            y2={b[1]}
          >
            <title>
              GT {label} edge {index}: {aId} {'->'} {bId}
            </title>
          </line>
        );
      })}
      {graph.vertices_px.map((point, index) => (
        <circle
          cx={point[0]}
          cy={point[1]}
          fill="none"
          key={`gt-vertex-${index}`}
          r={1.8}
          stroke="#334155"
          strokeOpacity={0.34}
          strokeWidth={0.8}
          vectorEffect="non-scaling-stroke"
        >
          <title>GT vertex {index}</title>
        </circle>
      ))}
    </g>
  );
}

function SelectionSpanGraphView({
  carriersById,
  frame,
  selection,
  verticesById,
}: {
  carriersById: Map<number, ArrangementCarrier>;
  frame: Stage2Response['overlay_frame_px'];
  selection: Stage5Response['selection'];
  verticesById: Map<number, ArrangementVertex>;
}) {
  const spanEndpointIds = new Set<number>();
  const degrees = new Map<number, number>();
  for (const span of selection.selected_spans) {
    spanEndpointIds.add(span.vertices[0]);
    spanEndpointIds.add(span.vertices[1]);
    degrees.set(span.vertices[0], (degrees.get(span.vertices[0]) ?? 0) + 1);
    degrees.set(span.vertices[1], (degrees.get(span.vertices[1]) ?? 0) + 1);
  }
  const endpoints = [...spanEndpointIds]
    .map((vertexId) => verticesById.get(vertexId))
    .filter((vertex): vertex is ArrangementVertex => Boolean(vertex));

  return (
    <g className="selection-span-graph" aria-label="Beam-selected final crease spans">
      {selection.selected_spans.map((span) => {
        const a = verticesById.get(span.vertices[0]);
        const b = verticesById.get(span.vertices[1]);
        if (!a || !b) return null;
        const carrier = carriersById.get(span.carrier_id);
        const p0 = carrier ? imagePoint(pointAtCarrierT(carrier, span.t_interval[0]), frame) : imagePoint(a.point, frame);
        const p1 = carrier ? imagePoint(pointAtCarrierT(carrier, span.t_interval[1]), frame) : imagePoint(b.point, frame);
        const color = arrangementAssignmentColor(span.assignment.label);
        const strokeWidth = span.kind === 'shared_carrier_span' ? 2.35 : 1.65;
        return (
          <g key={`selected-span-${span.id}`}>
            <line
              stroke="#ffffff"
              strokeLinecap="round"
              strokeOpacity={0.9}
              strokeWidth={strokeWidth + 1.9}
              vectorEffect="non-scaling-stroke"
              x1={p0.x}
              x2={p1.x}
              y1={p0.y}
              y2={p1.y}
            />
            <line
              stroke={color}
              strokeLinecap="round"
              strokeOpacity={span.kind === 'shared_carrier_span' ? 0.98 : 0.86}
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
              x1={p0.x}
              x2={p1.x}
              y1={p0.y}
              y2={p1.y}
            >
              <title>
                selected span {span.id}: {span.kind}; {span.assignment.label}; carrier {span.carrier_id}; endpoints {span.vertices[0]} {'->'}{' '}
                {span.vertices[1]}; {span.source_atomic_edge_ids.length} atomic evidence interval(s); {span.collapsed_vertex_ids.length} collapsed
                pass-through vertex/vertices; {span.replaced_atomic_edge_ids.length} replaced local fragment(s); score {span.score.toFixed(3)};{' '}
                {span.reasons.join('; ')}
              </title>
            </line>
          </g>
        );
      })}
      {endpoints.map((vertex) => (
        <SelectionSpanEndpointView degree={degrees.get(vertex.id) ?? 0} frame={frame} key={`selection-span-endpoint-${vertex.id}`} vertex={vertex} />
      ))}
    </g>
  );
}

function SelectionSpanEndpointView({
  degree,
  frame,
  vertex,
}: {
  degree: number;
  frame: Stage2Response['overlay_frame_px'];
  vertex: ArrangementVertex;
}) {
  const point = imagePoint(vertex.point, frame);
  const isBoundary = vertex.kind === 'corner' || vertex.kind === 'boundary_contact' || Boolean(vertex.boundary_side);
  const isObserved = vertex.kind === 'observed_junction' || vertex.kind === 'junction_cluster';
  const fill = isBoundary ? '#22c55e' : isObserved ? '#facc15' : '#f8fafc';
  const radius = isBoundary ? 3.1 : isObserved ? 3.0 : 2.45;
  return (
    <g aria-label="selected graph junction">
      <circle
        cx={point.x}
        cy={point.y}
        fill="#ffffff"
        fillOpacity={0.92}
        r={radius + 1.65}
        stroke="#ffffff"
        strokeWidth={0.8}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={point.x}
        cy={point.y}
        fill={fill}
        r={radius}
        stroke="#0f172a"
        strokeOpacity={0.88}
        strokeWidth={0.85}
        vectorEffect="non-scaling-stroke"
      >
        <title>
          selected span endpoint {vertex.id}; {vertex.kind}; selected span degree {degree}
        </title>
      </circle>
    </g>
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
      strokeWidth={decision === 'selected' ? 2.35 : 1.25}
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

function ExactVertexProbeView({
  displayStatus,
  frame,
  muted = false,
  probe,
  selected = false,
}: {
  displayStatus: ProbeStatusId;
  frame: Stage2Response['overlay_frame_px'];
  muted?: boolean;
  probe: VertexExactizabilityProbe;
  selected?: boolean;
}) {
  const point = imagePoint(probe.point, frame);
  const color = exactStatusColor(displayStatus);
  const isHard =
    displayStatus === 'infeasible' ||
    displayStatus === 'high_cost' ||
    displayStatus === 'odd_degree' ||
    displayStatus === 'hard_kawasaki';
  return (
    <circle
      cx={point.x}
      cy={point.y}
      fill="white"
      fillOpacity={selected ? 0.3 : muted ? 0.04 : isHard ? 0.2 : 0.08}
      r={selected ? 11 : displayStatus === 'infeasible' || displayStatus === 'odd_degree' || displayStatus === 'hard_kawasaki' ? 9 : displayStatus === 'high_cost' ? 7 : 5}
      stroke={color}
      strokeOpacity={muted ? 0.18 : isHard ? 0.95 : 0.55}
      strokeWidth={selected ? 2.6 : isHard ? 2.1 : 1.4}
      vectorEffect="non-scaling-stroke"
    >
      <title>
        vertex {probe.vertex_id}: {displayStatus.replaceAll('_', ' ')}; base status {probe.status.replaceAll('_', ' ')}; degree {probe.degree}; Kawasaki residual{' '}
        {probe.residual_before_degrees?.toFixed(3) ?? 'n/a'}°; move {probe.max_vertex_move.toFixed(5)}
        {probe.blockers.length ? `; ${probe.blockers.join('; ')}` : ''}
      </title>
    </circle>
  );
}

function ExactBoundaryProbeView({
  frame,
  muted = false,
  probe,
  selected = false,
}: {
  frame: Stage2Response['overlay_frame_px'];
  muted?: boolean;
  probe: BoundaryExactizabilityProbe;
  selected?: boolean;
}) {
  const point = imagePoint(probe.point, frame);
  const color = exactStatusColor(probe.status);
  const isHard = probe.status === 'infeasible' || probe.status === 'high_cost';
  const size = selected ? 15 : isHard ? 12 : 8;
  return (
    <rect
      fill="white"
      fillOpacity={selected ? 0.24 : muted ? 0.03 : isHard ? 0.16 : 0.06}
      height={size}
      stroke={color}
      strokeOpacity={muted ? 0.18 : isHard ? 0.95 : 0.55}
      strokeWidth={selected ? 2.6 : isHard ? 1.9 : 1.2}
      vectorEffect="non-scaling-stroke"
      width={size}
      x={point.x - size / 2}
      y={point.y - size / 2}
    >
      <title>
        boundary vertex {probe.vertex_id}: {probe.status.replaceAll('_', ' ')}; side {probe.side ?? 'nearest'}; boundary move{' '}
        {probe.max_vertex_move.toFixed(5)}
        {probe.blockers.length ? `; ${probe.blockers.join('; ')}` : ''}
      </title>
    </rect>
  );
}

function ExactCarrierProbeView({
  carrier,
  frame,
  muted = false,
  probe,
  selected = false,
}: {
  carrier: ArrangementCarrier;
  frame: Stage2Response['overlay_frame_px'];
  muted?: boolean;
  probe: CarrierExactizabilityProbe;
  selected?: boolean;
}) {
  const p0 = imagePoint(pointAtCarrierT(carrier, carrier.support_interval[0]), frame);
  const p1 = imagePoint(pointAtCarrierT(carrier, carrier.support_interval[1]), frame);
  const color = exactStatusColor(probe.status);
  const isHard = probe.status === 'infeasible' || probe.status === 'high_cost';
  return (
    <line
      stroke={color}
      strokeDasharray={isHard ? '10 5' : '4 5'}
      strokeLinecap="round"
      strokeOpacity={muted ? 0.14 : isHard ? 0.9 : 0.48}
      strokeWidth={selected ? 3.2 : isHard ? 2.4 : 1.4}
      vectorEffect="non-scaling-stroke"
      x1={p0.x}
      x2={p1.x}
      y1={p0.y}
      y2={p1.y}
    >
      <title>
        carrier {probe.carrier_id}: {probe.status.replaceAll('_', ' ')}; {probe.carrier_kind.replaceAll('_', ' ')}; selected edges{' '}
        {probe.selected_edges}; max endpoint move {probe.max_endpoint_move.toFixed(5)}, mean {probe.mean_endpoint_move.toFixed(5)}
        {probe.blockers.length ? `; ${probe.blockers.join('; ')}` : ''}
      </title>
    </line>
  );
}

function Stage4IssueContextView({
  carriersById,
  edgesById,
  frame,
  issue,
  scoresByEdgeId,
  showCarrierGeometry,
  verticesById,
}: {
  carriersById: Map<number, ArrangementCarrier>;
  edgesById: Map<number, ArrangementAtomicEdge>;
  frame: Stage2Response['overlay_frame_px'];
  issue: Stage4Issue;
  scoresByEdgeId: Map<number, Stage3Response['selection']['edge_scores'][number]>;
  showCarrierGeometry: boolean;
  verticesById: Map<number, ArrangementVertex>;
}) {
  const selectedIds = issue.selectedEdgeIds.slice(0, 120);
  const candidateIds = issue.candidateEdgeIds.slice(0, 80);
  const carrierIds = issue.carrierIds.slice(0, 24);
  return (
    <g aria-label={`Selected issue ${issue.label}`}>
      {carrierIds.map((carrierId) => {
        const carrier = carriersById.get(carrierId);
        return carrier ? <Stage4IssueCarrierContext carrier={carrier} frame={frame} key={`issue-carrier-${carrierId}`} /> : null;
      })}
      {candidateIds.map((edgeId) => {
        const edge = edgesById.get(edgeId);
        if (!edge) return null;
        return (
          <Stage4IssueEdgeContext
            edge={edge}
            frame={frame}
            key={`issue-candidate-${edgeId}`}
            role="candidate"
            score={scoresByEdgeId.get(edgeId)}
            carriersById={carriersById}
            showCarrierGeometry={showCarrierGeometry}
            verticesById={verticesById}
          />
        );
      })}
      {selectedIds.map((edgeId) => {
        const edge = edgesById.get(edgeId);
        if (!edge) return null;
        return (
          <Stage4IssueEdgeContext
            edge={edge}
            frame={frame}
            key={`issue-selected-${edgeId}`}
            role="selected"
            score={scoresByEdgeId.get(edgeId)}
            carriersById={carriersById}
            showCarrierGeometry={showCarrierGeometry}
            verticesById={verticesById}
          />
        );
      })}
      {issue.point ? <Stage4IssueFocusMarker frame={frame} issue={issue} /> : null}
    </g>
  );
}

function Stage4IssueCarrierContext({ carrier, frame }: { carrier: ArrangementCarrier; frame: Stage2Response['overlay_frame_px'] }) {
  const p0 = imagePoint(pointAtCarrierT(carrier, carrier.support_interval[0]), frame);
  const p1 = imagePoint(pointAtCarrierT(carrier, carrier.support_interval[1]), frame);
  return (
    <line
      stroke="#0f766e"
      strokeDasharray="13 8"
      strokeLinecap="round"
      strokeOpacity={0.72}
      strokeWidth={2.2}
      vectorEffect="non-scaling-stroke"
      x1={p0.x}
      x2={p1.x}
      y1={p0.y}
      y2={p1.y}
    >
      <title>
        associated carrier {carrier.id}: {carrier.kind.replaceAll('_', ' ')}
      </title>
    </line>
  );
}

function Stage4IssueEdgeContext({
  carriersById,
  edge,
  frame,
  role,
  score,
  showCarrierGeometry,
  verticesById,
}: {
  carriersById: Map<number, ArrangementCarrier>;
  edge: ArrangementAtomicEdge;
  frame: Stage2Response['overlay_frame_px'];
  role: 'selected' | 'candidate';
  score?: Stage3Response['selection']['edge_scores'][number];
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
  const color = role === 'selected' ? arrangementAssignmentColor(edge.assignment.label) : '#f59e0b';
  return (
    <g>
      <line
        stroke={role === 'selected' ? '#ffffff' : '#111827'}
        strokeLinecap="round"
        strokeOpacity={role === 'selected' ? 0.95 : 0.55}
        strokeWidth={role === 'selected' ? 4 : 3}
        vectorEffect="non-scaling-stroke"
        x1={p0.x}
        x2={p1.x}
        y1={p0.y}
        y2={p1.y}
      />
      <line
        stroke={color}
        strokeDasharray={role === 'selected' ? undefined : '9 6'}
        strokeLinecap="round"
        strokeOpacity={role === 'selected' ? 0.98 : 0.86}
        strokeWidth={role === 'selected' ? 2.2 : 1.6}
        vectorEffect="non-scaling-stroke"
        x1={p0.x}
        x2={p1.x}
        y1={p0.y}
        y2={p1.y}
      >
        <title>
          {role} associated edge {edge.id} carrier {edge.carrier_id}; score {score?.total_score.toFixed(3) ?? 'n/a'}
        </title>
      </line>
    </g>
  );
}

function Stage4IssueFocusMarker({ frame, issue }: { frame: Stage2Response['overlay_frame_px']; issue: Stage4Issue }) {
  if (!issue.point) return null;
  const point = imagePoint(issue.point, frame);
  const color = issue.color;
  return (
    <g>
      <circle
        cx={point.x}
        cy={point.y}
        fill="none"
        r={20}
        stroke="#ffffff"
        strokeOpacity={0.95}
        strokeWidth={3.5}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={point.x}
        cy={point.y}
        fill="none"
        r={20}
        stroke={color}
        strokeOpacity={0.98}
        strokeWidth={1.9}
        vectorEffect="non-scaling-stroke"
      />
      <line
        stroke={color}
        strokeLinecap="round"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        x1={point.x - 13}
        x2={point.x + 13}
        y1={point.y}
        y2={point.y}
      />
      <line
        stroke={color}
        strokeLinecap="round"
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        x1={point.x}
        x2={point.x}
        y1={point.y - 13}
        y2={point.y + 13}
      />
    </g>
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
  const isBeamSelection = report.exactizability_evaluated;
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
      <PanelTitle icon={<GitBranch size={17} />} title={isBeamSelection ? 'Stage 5 Beam Selection' : 'Stage 3 Selection'} />
      <LayerRow color="#16a34a" label="Selected edges" value={report.selected_edges} note="atomic intervals chosen for the graph" />
      <LayerRow color="#9333ea" label="Shared selected" value={selectedSharedEdges} note="selected intervals from shared straight carriers" />
      <LayerRow color="#475569" label="Observed selected" value={selectedObservedEdges} note="selected intervals from local observed carriers" />
      <LayerRow color="#0f766e" label="Selected carriers" value={selectedCarrierIds.size} note={`${selectedSharedCarriers} shared carrier(s) selected`} />
      <LayerRow color="#f59e0b" label="Undecided edges" value={report.undecided_edges} note="plausible evidence not selected yet" />
      <LayerRow color="#94a3b8" label="Rejected edges" value={report.rejected_edges} note="candidates below current costs" />
      <LayerRow color="#2563eb" label="Weak promoted" value={report.weak_edges_promoted} note="weak evidence selected by topology benefit" />
      <LayerRow color="#9333ea" label="Hypotheses" value={report.selected_hypotheses} note="arrangement hypotheses referenced by selection" />
      <LayerRow color="#ef4444" label="Odd vertices" value={report.odd_degree_vertices} note="remaining local topology warnings" />
      {isBeamSelection ? (
        <>
          <div className="hypothesis-divider" />
          <PanelTitle icon={<GitBranch size={17} />} title="Structural Edits" />
          <LayerRow color="#7c3aed" label="Shared replacements" value={report.shared_replacements} note="straight carriers replacing local fragments" />
          <LayerRow color="#7c3aed" label="Fragments replaced" value={report.local_fragments_replaced} note="local intervals explained by shared carriers" />
          <LayerRow color="#f59e0b" label="Fragments retained" value={report.local_fragments_retained} note="local intervals kept despite shared alternatives" />
          <LayerRow color="#0f766e" label="Pass-through vertices" value={report.collapsible_degree_two_vertices} note="degree-2 collinear vertices to collapse later" />
          <LayerRow color="#dc2626" label="Bad degree-2 vertices" value={report.non_collinear_degree_two_vertices} note="degree-2 pseudo-junction penalties" />
        </>
      ) : null}
      <div className="hypothesis-divider" />
      <div className="selection-status-row">
        <span>Total selected score</span>
        <strong>{report.total_score.toFixed(2)}</strong>
      </div>
      {isBeamSelection ? (
        <>
          <div className="selection-status-row">
            <span>Continuity reward</span>
            <strong>{report.continuity_reward.toFixed(2)}</strong>
          </div>
          <div className="selection-status-row">
            <span>Structural penalty</span>
            <strong>{report.structural_penalty.toFixed(2)}</strong>
          </div>
        </>
      ) : null}
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
        {isBeamSelection
          ? 'Stage 5 shows the exactizability-aware selected graph candidate. Toggle GT graph to compare the selected topology against the known fold file.'
          : 'Stage 3 shows the selected graph candidate by default. Turn on observed carriers or shared alternatives only when comparing the choice against Stage 2 evidence. Exact geometric theorem costs arrive in Phase 4.'}
      </p>
    </div>
  );
}

function Stage4LayerSummary({
  filteredIssues,
  issueFilter,
  issues,
  onIssueFilterChange,
  onSelectIssue,
  onToggleProbe,
  probeVisibility,
  selectedIssue,
  stage,
}: {
  filteredIssues: Stage4Issue[];
  issueFilter: Stage4IssueFilter;
  issues: Stage4Issue[];
  onIssueFilterChange: (filter: Stage4IssueFilter) => void;
  onSelectIssue: (issue: Stage4Issue) => void;
  onToggleProbe: (status: ProbeStatusId, kind: ProbeKindId) => void;
  probeVisibility: ProbeVisibility;
  selectedIssue: Stage4Issue | null;
  stage: Stage4Response;
}) {
  const summary = stage.exactizability.summary;
  const issueSections = stage4IssueSections(issues, issueFilter);
  return (
    <div className="hypothesis-panel">
      <PanelTitle icon={<ListFilter size={17} />} title="Issue Debugger" />
      <div className="issue-filter-grid">
        {ISSUE_FILTERS.map((filter) => (
          <button
            className={filter.id === issueFilter ? 'issue-filter selected' : 'issue-filter'}
            key={filter.id}
            onClick={() => onIssueFilterChange(filter.id)}
          >
            <span>{filter.label}</span>
            <b>{filterStage4Issues(issues, filter.id).length}</b>
          </button>
        ))}
      </div>
      {selectedIssue ? <Stage4IssueDetail issue={selectedIssue} /> : <p>No exactizability issues match this filter.</p>}
      <div className="issue-list">
        {issueSections.map((section) => (
          <div className="issue-section" key={section.id}>
            <div className="issue-section-header">
              <span>{section.label}</span>
              <b>
                showing {section.issues.length} / {section.total}
              </b>
            </div>
            {section.issues.map((issue) => (
              <Stage4IssueRow
                issue={issue}
                key={`${section.id}-${issue.id}`}
                onSelect={() => onSelectIssue(issue)}
                selected={selectedIssue?.id === issue.id}
              />
            ))}
          </div>
        ))}
      </div>
      {filteredIssues.length > ISSUE_LIST_LIMIT_PER_TYPE ? (
        <p>
          Showing up to {ISSUE_LIST_LIMIT_PER_TYPE} issue(s) per selected type. Use filters to focus a specific family.
        </p>
      ) : null}
      <div className="hypothesis-divider" />
      <PanelTitle icon={<GitBranch size={17} />} title="Probe Visibility" />
      <div className="probe-kind-header">
        <span />
        <span />
        <b>V</b>
        <b>C</b>
        <b>B</b>
        <span />
      </div>
      {PROBE_STATUS_ROWS.map((row) => (
        <ProbeToggleRow
          key={row.id}
          row={row}
          value={stage4ProbeRowCount(summary, row.id)}
          visibility={probeVisibility[row.id]}
          onToggle={(kind) => onToggleProbe(row.id, kind)}
        />
      ))}
      <div className="hypothesis-divider" />
      <div className="selection-status-row">
        <span>Max Kawasaki residual</span>
        <strong>{summary.max_kawasaki_residual_degrees.toFixed(3)}°</strong>
      </div>
      <div className="selection-status-row">
        <span>Max vertex move</span>
        <strong>{summary.max_estimated_vertex_move.toFixed(5)}</strong>
      </div>
      <div className="selection-status-row">
        <span>Max carrier endpoint move</span>
        <strong>{summary.max_carrier_endpoint_move.toFixed(5)}</strong>
      </div>
      <div className="selection-status-row">
        <span>Max boundary move</span>
        <strong>{summary.max_boundary_move.toFixed(5)}</strong>
      </div>
      <div className="selection-status-row">
        <span>Total estimated energy</span>
        <strong>{summary.total_estimated_energy.toFixed(2)}</strong>
      </div>
      <p>
        Stage 4 does not alter the graph. Select an issue to highlight the associated selected edges, weak candidates,
        carriers, and local theorem evidence.
      </p>
    </div>
  );
}

function Stage4IssueRow({
  issue,
  onSelect,
  selected,
}: {
  issue: Stage4Issue;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button className={selected ? 'issue-row selected' : 'issue-row'} onClick={onSelect}>
      <span className="layer-swatch" style={{ background: issue.color }} />
      <span>
        <strong>{issue.label}</strong>
        <em>{issue.summary}</em>
      </span>
      <b>{issue.valueLabel}</b>
    </button>
  );
}

function Stage4IssueDetail({ issue }: { issue: Stage4Issue }) {
  const alternating = issue.sectorAngles ? alternatingAngleSums(issue.sectorAngles) : null;
  return (
    <div className="issue-detail">
      <div className="issue-detail-title">
        <span className="layer-swatch" style={{ background: issue.color }} />
        <strong>{issue.label}</strong>
        <b>{issue.valueLabel}</b>
      </div>
      <p>{issue.detail}</p>
      <div className="issue-facts">
        <span>selected edges</span>
        <strong>{issue.selectedEdgeIds.length}</strong>
        <span>candidate edges</span>
        <strong>{issue.candidateEdgeIds.length}</strong>
        <span>carriers</span>
        <strong>{issue.carrierIds.length}</strong>
      </div>
      {alternating ? (
        <div className="kawasaki-panel">
          <span>Kawasaki sums</span>
          <strong>
            {alternating.even.toFixed(2)}° / {alternating.odd.toFixed(2)}°
          </strong>
          <em>residual {Math.abs(alternating.even - alternating.odd).toFixed(2)}°</em>
        </div>
      ) : null}
      {issue.blockers.length ? (
        <div className="blocker-list">
          {issue.blockers.slice(0, 4).map((blocker) => (
            <span key={blocker}>{blocker}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProbeToggleRow({
  onToggle,
  row,
  value,
  visibility,
}: {
  onToggle: (kind: ProbeKindId) => void;
  row: (typeof PROBE_STATUS_ROWS)[number];
  value: number;
  visibility: Record<ProbeKindId, boolean>;
}) {
  return (
    <div className="probe-toggle-row">
      <span className="layer-swatch" style={{ background: row.color }} />
      <span className="probe-toggle-copy">
        <strong>{row.label}</strong>
        <em>{row.note}</em>
      </span>
      {(['vertex', 'carrier', 'boundary'] as ProbeKindId[]).map((kind) => {
        const available = row.kinds.includes(kind);
        return (
          <label className={available ? 'probe-kind-toggle' : 'probe-kind-toggle disabled'} key={kind}>
            <input
              aria-label={`${row.label} ${PROBE_KIND_LABELS[kind]} probes`}
              checked={available ? visibility[kind] : false}
              disabled={!available}
              onChange={() => onToggle(kind)}
              type="checkbox"
            />
          </label>
        );
      })}
      <b>{value}</b>
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

function groundTruthAssignmentColor(label: string) {
  if (label === 'M' || label === 'mountain') return '#991b1b';
  if (label === 'V' || label === 'valley') return '#1d4ed8';
  if (label === 'B' || label === 'boundary') return '#020617';
  return '#475569';
}

function buildStage4Issues(stage: Stage4Response): Stage4Issue[] {
  const selectedEdgeIds = new Set(stage.selection.selected_edge_ids);
  const candidateEdgeIds = new Set([...stage.selection.undecided_edge_ids, ...stage.selection.rejected_edge_ids]);
  const verticesById = new Map(stage.arrangement.vertices.map((vertex) => [vertex.id, vertex]));
  const carriersById = new Map(stage.arrangement.carriers.map((carrier) => [carrier.id, carrier]));
  const edgeById = new Map(stage.arrangement.atomic_edges.map((edge) => [edge.id, edge]));
  const edgesByVertex = new Map<
    number,
    { selectedEdgeIds: number[]; candidateEdgeIds: number[]; carrierIds: Set<number> }
  >();
  const edgesByCarrier = new Map<number, { selectedEdgeIds: number[]; candidateEdgeIds: number[] }>();

  for (const edge of stage.arrangement.atomic_edges) {
    const carrierEntry = edgesByCarrier.get(edge.carrier_id) ?? { selectedEdgeIds: [], candidateEdgeIds: [] };
    if (selectedEdgeIds.has(edge.id)) carrierEntry.selectedEdgeIds.push(edge.id);
    if (candidateEdgeIds.has(edge.id)) carrierEntry.candidateEdgeIds.push(edge.id);
    edgesByCarrier.set(edge.carrier_id, carrierEntry);

    for (const vertexId of edge.vertices) {
      const vertexEntry = edgesByVertex.get(vertexId) ?? {
        selectedEdgeIds: [],
        candidateEdgeIds: [],
        carrierIds: new Set<number>(),
      };
      if (selectedEdgeIds.has(edge.id)) vertexEntry.selectedEdgeIds.push(edge.id);
      if (candidateEdgeIds.has(edge.id)) vertexEntry.candidateEdgeIds.push(edge.id);
      vertexEntry.carrierIds.add(edge.carrier_id);
      edgesByVertex.set(vertexId, vertexEntry);
    }
  }

  const vertexAssociation = (vertexId: number, incidentEdgeIds: number[] = []) => {
    const vertex = verticesById.get(vertexId);
    const entry = edgesByVertex.get(vertexId);
    const selected = uniqueNumbers([
      ...incidentEdgeIds.filter((edgeId) => selectedEdgeIds.has(edgeId)),
      ...(entry?.selectedEdgeIds ?? []),
    ]);
    const candidates = uniqueNumbers([
      ...incidentEdgeIds.filter((edgeId) => candidateEdgeIds.has(edgeId)),
      ...(entry?.candidateEdgeIds ?? []),
    ]);
    const carriers = new Set<number>(vertex?.carrier_ids ?? []);
    for (const carrierId of entry?.carrierIds ?? []) carriers.add(carrierId);
    for (const edgeId of [...selected, ...candidates]) {
      const edge = edgeById.get(edgeId);
      if (edge) carriers.add(edge.carrier_id);
    }
    return {
      candidateEdgeIds: candidates,
      carrierIds: Array.from(carriers),
      point: vertex?.point,
      selectedEdgeIds: selected,
    };
  };

  const carrierAssociation = (carrierId: number) => {
    const entry = edgesByCarrier.get(carrierId);
    return {
      candidateEdgeIds: uniqueNumbers(entry?.candidateEdgeIds ?? []),
      carrierIds: [carrierId],
      selectedEdgeIds: uniqueNumbers(entry?.selectedEdgeIds ?? []),
    };
  };

  const issues: Stage4Issue[] = [];
  const pushIssue = (issue: Stage4Issue) => {
    issues.push({
      ...issue,
      candidateEdgeIds: issue.candidateEdgeIds.slice(0, 220),
      carrierIds: uniqueNumbers(issue.carrierIds).slice(0, 80),
      selectedEdgeIds: uniqueNumbers(issue.selectedEdgeIds).slice(0, 220),
    });
  };

  for (const probe of stage.exactizability.vertex_probes) {
    const associated = vertexAssociation(probe.vertex_id, probe.incident_edge_ids);
    const residual = probe.residual_before_degrees ?? 0;
    if (residual > 12) {
      pushIssue({
        ...associated,
        blockers: probe.blockers,
        color: exactStatusColor('hard_kawasaki'),
        degree: probe.degree,
        detail: `Alternating sector angles around vertex ${probe.vertex_id} differ by ${residual.toFixed(2)} degrees before exactization.`,
        id: `vertex-${probe.vertex_id}-hard-kawasaki`,
        label: `vertex ${probe.vertex_id}`,
        maxMove: probe.max_vertex_move,
        probeKind: 'vertex',
        rayAngles: probe.ray_angles_degrees,
        residualDegrees: residual,
        sectorAngles: probe.sector_angles_degrees,
        status: 'hard_kawasaki',
        summary: `hard Kawasaki, degree ${probe.degree}`,
        value: residual,
        valueLabel: `${residual.toFixed(1)}deg`,
        vertexId: probe.vertex_id,
      });
    }
    if (probe.degree % 2 === 1) {
      pushIssue({
        ...associated,
        blockers: probe.blockers,
        color: exactStatusColor('odd_degree'),
        degree: probe.degree,
        detail: `Vertex ${probe.vertex_id} has odd degree ${probe.degree}; geometry movement alone cannot make this locally flat-foldable.`,
        id: `vertex-${probe.vertex_id}-odd-degree`,
        label: `vertex ${probe.vertex_id}`,
        maxMove: probe.max_vertex_move,
        probeKind: 'vertex',
        residualDegrees: probe.residual_before_degrees,
        sectorAngles: probe.sector_angles_degrees,
        status: 'odd_degree',
        summary: `odd degree ${probe.degree}`,
        value: probe.degree,
        valueLabel: `degree ${probe.degree}`,
        vertexId: probe.vertex_id,
      });
    }
    if (probe.status === 'infeasible' || probe.status === 'high_cost') {
      const status = probe.status as ProbeStatusId;
      pushIssue({
        ...associated,
        blockers: probe.blockers,
        color: exactStatusColor(status),
        degree: probe.degree,
        detail: `Vertex ${probe.vertex_id} is ${status.replaceAll('_', ' ')} with max estimated movement ${probe.max_vertex_move.toFixed(5)}.`,
        id: `vertex-${probe.vertex_id}-${status}`,
        label: `vertex ${probe.vertex_id}`,
        maxMove: probe.max_vertex_move,
        probeKind: 'vertex',
        residualDegrees: probe.residual_before_degrees,
        sectorAngles: probe.sector_angles_degrees,
        status,
        summary: `${status.replaceAll('_', ' ')}, move ${probe.max_vertex_move.toFixed(4)}`,
        value: Math.max(probe.max_vertex_move, probe.residual_before_degrees ?? 0),
        valueLabel: probe.max_vertex_move.toFixed(4),
        vertexId: probe.vertex_id,
      });
    }
  }

  for (const probe of stage.exactizability.carrier_probes) {
    if (probe.status !== 'infeasible' && probe.status !== 'high_cost') continue;
    const status = probe.status as ProbeStatusId;
    const carrier = carriersById.get(probe.carrier_id);
    const p0 = carrier ? pointAtCarrierT(carrier, carrier.support_interval[0]) : null;
    const p1 = carrier ? pointAtCarrierT(carrier, carrier.support_interval[1]) : null;
    pushIssue({
      ...carrierAssociation(probe.carrier_id),
      blockers: probe.blockers,
      carrierId: probe.carrier_id,
      color: exactStatusColor(status),
      detail: `Carrier ${probe.carrier_id} is ${status.replaceAll('_', ' ')}; projecting its selected intervals would move endpoints by up to ${probe.max_endpoint_move.toFixed(5)}.`,
      id: `carrier-${probe.carrier_id}-${status}`,
      label: `carrier ${probe.carrier_id}`,
      maxMove: probe.max_endpoint_move,
      point: p0 && p1 ? { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 } : undefined,
      probeKind: 'carrier',
      status,
      summary: `${probe.carrier_kind.replaceAll('_', ' ')}, ${probe.selected_edges} selected`,
      value: probe.max_endpoint_move,
      valueLabel: probe.max_endpoint_move.toFixed(4),
    });
  }

  for (const probe of stage.exactizability.boundary_probes) {
    if (probe.status !== 'infeasible' && probe.status !== 'high_cost') continue;
    const status = probe.status as ProbeStatusId;
    const associated = vertexAssociation(probe.vertex_id);
    pushIssue({
      ...associated,
      blockers: probe.blockers,
      color: exactStatusColor(status),
      detail: `Boundary vertex ${probe.vertex_id} on ${probe.side ?? 'nearest'} side needs movement ${probe.max_vertex_move.toFixed(5)} to stay on the square boundary.`,
      id: `boundary-${probe.vertex_id}-${status}`,
      label: `boundary ${probe.vertex_id}`,
      maxMove: probe.max_vertex_move,
      point: probe.point,
      probeKind: 'boundary',
      side: probe.side,
      status,
      summary: `${status.replaceAll('_', ' ')}, side ${probe.side ?? 'nearest'}`,
      value: probe.max_vertex_move,
      valueLabel: probe.max_vertex_move.toFixed(4),
      vertexId: probe.vertex_id,
    });
  }

  return issues.sort((left, right) => issuePriority(right) - issuePriority(left) || right.value - left.value);
}

function filterStage4Issues(issues: Stage4Issue[], filter: Stage4IssueFilter) {
  if (filter === 'all') return issues;
  if (filter === 'vertex' || filter === 'carrier' || filter === 'boundary') {
    return issues.filter((issue) => issue.probeKind === filter);
  }
  return issues.filter((issue) => issue.status === filter);
}

function stage4IssueSections(issues: Stage4Issue[], filter: Stage4IssueFilter): Stage4IssueSection[] {
  const sectionFilters = filter === 'all' ? ISSUE_FILTERS.filter((entry) => entry.id !== 'all') : ISSUE_FILTERS.filter((entry) => entry.id === filter);
  return sectionFilters
    .map((entry) => {
      const sectionIssues = filterStage4Issues(issues, entry.id);
      return {
        id: entry.id,
        issues: sectionIssues.slice(0, ISSUE_LIST_LIMIT_PER_TYPE),
        label: entry.label,
        total: sectionIssues.length,
      };
    })
    .filter((section) => section.total > 0);
}

function issuePriority(issue: Stage4Issue) {
  if (issue.status === 'infeasible') return 50;
  if (issue.status === 'hard_kawasaki') return 42;
  if (issue.status === 'odd_degree') return 38;
  if (issue.status === 'high_cost') return 30;
  return 0;
}

function stage4IssueMatchesProbe(
  issue: Stage4Issue,
  kind: ProbeKindId,
  probe: VertexExactizabilityProbe | CarrierExactizabilityProbe | BoundaryExactizabilityProbe,
  _displayStatus?: ProbeStatusId,
) {
  if (issue.probeKind !== kind) return false;
  if (kind === 'carrier') return issue.carrierId === (probe as CarrierExactizabilityProbe).carrier_id;
  return issue.vertexId === (probe as VertexExactizabilityProbe | BoundaryExactizabilityProbe).vertex_id;
}

function uniqueNumbers(values: Iterable<number>) {
  return Array.from(new Set(values));
}

function alternatingAngleSums(angles: number[]) {
  return angles.reduce(
    (acc, angle, index) => {
      if (index % 2 === 0) acc.even += angle;
      else acc.odd += angle;
      return acc;
    },
    { even: 0, odd: 0 },
  );
}

function stage4ProbeRowCount(summary: Stage4Response['exactizability']['summary'], status: ProbeStatusId) {
  if (status === 'odd_degree') return summary.odd_degree_vertices;
  if (status === 'hard_kawasaki') return summary.hard_kawasaki_vertices;
  return summary[status];
}

function isProbeStatusVisible(status: string, kind: ProbeKindId, visibility: ProbeVisibility) {
  if (status === 'feasible' || status === 'low_cost' || status === 'high_cost' || status === 'infeasible') {
    return visibility[status][kind];
  }
  return false;
}

function vertexProbeDisplayStatus(probe: VertexExactizabilityProbe, visibility: ProbeVisibility): ProbeStatusId | null {
  if (visibility.odd_degree.vertex && probe.degree % 2 === 1) return 'odd_degree';
  if (visibility.hard_kawasaki.vertex && (probe.residual_before_degrees ?? 0) > 12) return 'hard_kawasaki';
  if (isProbeStatusVisible(probe.status, 'vertex', visibility)) {
    return probe.status as ProbeStatusId;
  }
  return null;
}

function exactStatusColor(status: string) {
  if (status === 'odd_degree') return '#ef4444';
  if (status === 'hard_kawasaki') return '#9333ea';
  if (status === 'feasible') return '#16a34a';
  if (status === 'low_cost') return '#0891b2';
  if (status === 'high_cost') return '#f59e0b';
  if (status === 'infeasible') return '#dc2626';
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
