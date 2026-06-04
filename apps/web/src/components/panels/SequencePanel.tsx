import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Layers3, Play, Waves } from 'lucide-react';
import type {
  FoldDocument,
  SequenceInstructionStep,
  SequencePlan,
  SequenceStateSnapshot,
  SequenceStepCertificate,
  SequenceTargetState,
} from '../../engine/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/Button';

const PREVIEW_VIEWBOX = 320;
const PREVIEW_PADDING = 24;

export function SequencePanel() {
  const foldArtifacts = useWorkspaceStore((state) => state.foldArtifacts);
  const foldArtifactError = useWorkspaceStore((state) => state.foldArtifactError);
  const foldArtifactStatus = useWorkspaceStore((state) => state.foldArtifactStatus);
  const sequencePlan = useWorkspaceStore((state) => state.sequencePlan);
  const sequenceTarget = useWorkspaceStore((state) => state.sequenceTarget);
  const sequencePlanning = useWorkspaceStore((state) => state.sequencePlanning);
  const sequenceError = useWorkspaceStore((state) => state.sequenceError);
  const ensureFoldArtifacts = useWorkspaceStore((state) => state.ensureFoldArtifacts);
  const planFoldingSequence = useWorkspaceStore((state) => state.planFoldingSequence);
  const planningElapsedSeconds = usePlanningElapsed(sequencePlanning);

  useEffect(() => {
    if (foldArtifacts) return;
    if (foldArtifactStatus !== 'idle' && foldArtifactStatus !== 'stale') return;
    void ensureFoldArtifacts();
  }, [ensureFoldArtifacts, foldArtifacts, foldArtifactStatus]);

  const statusTone =
    sequenceError || sequencePlan?.status === 'unsupported'
      ? 'bad'
      : sequencePlan?.status === 'complete'
        ? 'good'
        : sequencePlan
          ? 'warn'
          : 'warn';
  const statusLabel = sequencePlanning
    ? 'Planning sequence'
    : sequenceError
      ? sequenceError
      : foldArtifactStatus === 'loading'
        ? 'Preparing crease pattern'
      : sequencePlan
        ? formatStatus(sequencePlan.status)
        : foldArtifacts
          ? 'Sequence not planned'
          : foldArtifactError || 'Crease pattern pending';
  const headerSummary = sequencePlanning
    ? `Planning | ${formatElapsed(planningElapsedSeconds)}`
    : sequencePlan
      ? `${formatStatus(sequencePlan.status)} | ${sequencePlan.steps.length} step${sequencePlan.steps.length === 1 ? '' : 's'}`
      : statusLabel;

  return (
    <section className="panel-shell sequence-panel">
      <div className="panel-toolbar">
        <div className="panel-toolbar__group">
          <span className="panel-title">Sequence</span>
          <span className="sequence-panel__toolbar-summary" data-tone={statusTone}>
            {headerSummary}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={sequencePlanning || !foldArtifacts}
          onClick={() => void planFoldingSequence()}
        >
          <Play size={14} />
          {sequencePlanning ? 'Planning' : 'Plan'}
        </Button>
      </div>
      <div className="panel-body sequence-panel__body">
        <SequenceDetails
          sequencePlan={sequencePlan}
          sequenceTarget={sequenceTarget}
          statusTone={statusTone}
          statusLabel={statusLabel}
          sequencePlanning={sequencePlanning}
          planningElapsedSeconds={planningElapsedSeconds}
        />
        {sequencePlanning && <SequencePlanningProgress elapsedSeconds={planningElapsedSeconds} />}
        {sequencePlan && (
          <SequenceDiagramList plan={sequencePlan} />
        )}
      </div>
    </section>
  );
}

function SequenceDetails({
  sequencePlan,
  sequenceTarget,
  statusTone,
  statusLabel,
  sequencePlanning,
  planningElapsedSeconds,
}: {
  sequencePlan: SequencePlan | null;
  sequenceTarget: SequenceTargetState | null;
  statusTone: 'good' | 'warn' | 'bad';
  statusLabel: string;
  sequencePlanning: boolean;
  planningElapsedSeconds: number;
}) {
  return (
    <details className="sequence-panel__details">
      <summary>
        <span>Details</span>
        <span>
          {sequencePlanning
            ? `Planning ${formatElapsed(planningElapsedSeconds)}`
            : sequencePlan
              ? formatStatus(sequencePlan.status)
              : statusLabel}
        </span>
      </summary>
      <div className="metric-grid sequence-panel__metrics">
        <Metric label="Status" value={sequencePlan ? formatStatus(sequencePlan.status) : 'Idle'} />
        <Metric label="Steps" value={sequencePlan?.steps.length ?? 0} />
        <Metric label="Open" value={sequencePlan?.search.best_unresolved_creases ?? 0} />
        <Metric label="States" value={sequencePlan?.search.states_explored ?? 0} />
      </div>
      <div className="status-row" data-tone={statusTone}>
        {statusTone === 'good' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <span>{statusLabel}</span>
      </div>
      {sequenceTarget && (
        <div className="status-row" data-tone="good">
          <CheckCircle2 size={15} />
          <span>
            {sequenceTarget.normalized.faces_vertices.length} faces, {sequenceTarget.states} layer
            state{sequenceTarget.states === '1' ? '' : 's'}
          </span>
        </div>
      )}
      {sequencePlan?.search.budget_exhausted && (
        <div className="status-row" data-tone="warn">
          <CircleDashed size={15} />
          <span>Search budget reached with a partial result</span>
        </div>
      )}
      {sequencePlan?.diagnostics.slice(0, 4).map((diagnostic) => (
        <div
          key={`${diagnostic.code}:${diagnostic.message}`}
          className="status-row"
          data-tone={diagnostic.severity === 'error' ? 'bad' : 'warn'}
        >
          <CircleDashed size={15} />
          <span>{diagnostic.message}</span>
        </div>
      ))}
    </details>
  );
}

function SequencePlanningProgress({ elapsedSeconds }: { elapsedSeconds: number }) {
  return (
    <div className="sequence-planning-card" role="status" aria-live="polite">
      <div className="sequence-planning-card__header">
        <span>Planning folding sequence</span>
        <span>{formatElapsed(elapsedSeconds)}</span>
      </div>
      <div
        className="sequence-planning-progress"
        role="progressbar"
        aria-label="Sequence planning in progress"
      >
        <span />
      </div>
      <p>{planningMessage(elapsedSeconds)}</p>
    </div>
  );
}

function SequenceDiagramList({ plan }: { plan: SequencePlan }) {
  const setSequenceSimulationFocus = useWorkspaceStore((state) => state.setSequenceSimulationFocus);
  const activatePanel = useLayoutStore((state) => state.activatePanel);
  const stateById = useMemo(
    () => new Map(plan.states.map((state) => [state.id, state])),
    [plan.states]
  );

  if (plan.steps.length === 0) {
    return (
      <ol className="sequence-panel__steps">
        <li className="sequence-panel__empty-step">No sequence steps</li>
      </ol>
    );
  }

  return (
    <ol className="sequence-panel__steps" aria-label="Folding sequence diagram">
      {plan.steps.map((step, index) => {
        const beforeState = step.before_state ? stateById.get(step.before_state) : null;
        const afterState = step.after_state ? stateById.get(step.after_state) : null;
        const highlights = highlightsForStep(step);
        return (
          <li key={step.id} className="sequence-diagram-step">
            <div className="sequence-diagram-step__header">
              <div className="sequence-diagram-step__header-main">
                <span>Step {index + 1}</span>
                <strong>{formatKind(step.kind)}</strong>
                {step.certificate && (
                  <span
                    className="sequence-diagram-step__certificate"
                    data-tone={certificateTone(step.certificate)}
                    title={certificateTitle(step.certificate)}
                  >
                    {formatCertificateStatus(step.certificate)}
                  </span>
                )}
              </div>
              <div className="sequence-diagram-step__header-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  className="sequence-diagram-step__simulate"
                  title="Simulate step"
                  aria-label="Simulate step"
                  onClick={() => {
                    setSequenceSimulationFocus({ kind: 'sequence_step', stepId: step.id });
                    activatePanel('simulator');
                  }}
                >
                  <Waves size={13} />
                  Simulate
                </Button>
              </div>
            </div>
            <div className="sequence-diagram-step__visuals">
              <SequencePreview
                title="Before"
                state={beforeState}
                mode="folded"
                highlights={highlights}
                stepLabel={`Step ${index + 1}`}
              />
              <div className="sequence-diagram-step__arrow" aria-hidden="true">
                <ArrowRight size={17} />
              </div>
              <SequencePreview
                title="After"
                state={afterState}
                mode="folded"
                highlights={highlights}
                stepLabel={`Step ${index + 1}`}
              />
            </div>
            <div className="sequence-diagram-step__copy">
              <div className="sequence-diagram-step__label">{step.label}</div>
              <div className="sequence-diagram-step__meta">
                {step.after_state ? `${step.before_state} to ${step.after_state}` : formatKind(step.kind)}
              </div>
              {step.certificate && (
                <div className="sequence-diagram-step__certificate-note">
                  {certificateNote(step.certificate)}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SequencePreview({
  title,
  state,
  mode,
  highlights,
  stepLabel,
}: {
  title: string;
  state: SequenceStateSnapshot | null | undefined;
  mode: 'paper' | 'folded';
  highlights: SequenceHighlights;
  stepLabel?: string;
}) {
  const projection = useMemo(() => {
    if (!state) return null;
    return createPreviewProjection(pointsForState(state, mode));
  }, [mode, state]);

  if (!state || !projection) {
    return (
      <div className="sequence-panel__preview" data-empty>
        <div className="sequence-panel__preview-title">
          <Layers3 size={13} />
          <span>{title}</span>
        </div>
        <div className="sequence-panel__preview-empty">State unavailable</div>
      </div>
    );
  }

  const points = pointsForState(state, mode);

  return (
    <div className="sequence-panel__preview">
      <div className="sequence-panel__preview-title">
        <Layers3 size={13} />
        <span>{title}</span>
        <span>{state.id}</span>
      </div>
      <svg
        className="sequence-preview-canvas"
        viewBox={`0 0 ${PREVIEW_VIEWBOX} ${PREVIEW_VIEWBOX}`}
        role="img"
        aria-label={[stepLabel, title, mode === 'folded' ? 'folded state' : 'crease pattern', state.id]
          .filter(Boolean)
          .join(' ')}
      >
        <rect className="sequence-preview-plane" x="12" y="12" width="296" height="296" rx="4" />
        {state.document.faces_vertices.map((face, index) => {
          const polygon = polygonPoints(face, points, projection);
          if (!polygon) return null;
          return (
            <polygon
              key={`face-${index}`}
              className={[
                'sequence-preview-face',
                highlights.faces.has(index) ? 'sequence-preview-face--highlight' : '',
              ].join(' ')}
              points={polygon}
            />
          );
        })}
        {state.document.edges_vertices.map(([a, b], index) => {
          const p1 = projection(points[a]);
          const p2 = projection(points[b]);
          if (!p1 || !p2) return null;
          return (
            <line
              key={`edge-${index}`}
              className={[
                'sequence-preview-crease',
                `sequence-preview-crease--${assignmentForEdge(state.document, index).toLowerCase()}`,
                highlights.creases.has(index) ? 'sequence-preview-crease--highlight' : '',
              ].join(' ')}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
            />
          );
        })}
      </svg>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__value">{value}</div>
    </div>
  );
}

function usePlanningElapsed(active: boolean): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    if (typeof window === 'undefined') return;
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [active]);

  return elapsedSeconds;
}

function planningMessage(elapsedSeconds: number): string {
  if (elapsedSeconds >= 60) {
    return `Still planning after ${formatElapsed(elapsedSeconds)}. Large crease patterns can take a while; this run is still active.`;
  }
  if (elapsedSeconds >= 15) {
    return 'Searching sequence states. Complex crease patterns may take longer than simple bases.';
  }
  return 'Resolving the flat-fold target and searching for fold steps.';
}

function formatElapsed(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

function formatKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}

function formatCertificateStatus(certificate: SequenceStepCertificate): string {
  return certificate.status.replaceAll('_', ' ');
}

function certificateTone(certificate: SequenceStepCertificate): 'good' | 'warn' | 'bad' {
  if (certificate.status === 'verified') return 'good';
  if (certificate.status === 'manual') return 'bad';
  return 'warn';
}

function certificateTitle(certificate: SequenceStepCertificate): string {
  return `${formatCertificateStatus(certificate)} by ${certificate.recognizer.replaceAll('_', ' ')}`;
}

function certificateNote(certificate: SequenceStepCertificate): string {
  const uncertainChecks = [...certificate.preconditions, ...certificate.postconditions].filter(
    (check) => check.status === 'warning' || check.status === 'not_checked'
  ).length;
  const suffix = uncertainChecks > 0 ? ` | ${uncertainChecks} open check${uncertainChecks === 1 ? '' : 's'}` : '';
  return `${certificate.recognizer.replaceAll('_', ' ')}${suffix}`;
}

interface SequenceHighlights {
  creases: Set<number>;
  faces: Set<number>;
}

function highlightsForStep(step: SequenceInstructionStep): SequenceHighlights {
  const region = (step as { region?: { creases: number[]; faces: number[] } }).region;
  return {
    creases: new Set(region?.creases ?? step.affected_creases ?? []),
    faces: new Set(region?.faces ?? step.affected_faces ?? []),
  };
}

function pointsForState(state: SequenceStateSnapshot, mode: 'paper' | 'folded'): Array<[number, number]> {
  if (mode === 'folded' && state.folded_vertices.length === state.document.vertices_coords.length) {
    return state.folded_vertices;
  }
  return state.document.vertices_coords.map((coord) => [coord[0] ?? 0, coord[1] ?? 0]);
}

function createPreviewProjection(points: Array<[number, number]>) {
  if (points.length === 0) return null;
  const bounds = points.reduce(
    (acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      maxX: Math.max(acc.maxX, x),
      minY: Math.min(acc.minY, y),
      maxY: Math.max(acc.maxY, y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : 1;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 1;
  const spanX = Math.max(0.001, maxX - minX);
  const spanY = Math.max(0.001, maxY - minY);
  const scale = Math.min(
    (PREVIEW_VIEWBOX - PREVIEW_PADDING * 2) / spanX,
    (PREVIEW_VIEWBOX - PREVIEW_PADDING * 2) / spanY
  );
  const offsetX = (PREVIEW_VIEWBOX - spanX * scale) / 2;
  const offsetY = (PREVIEW_VIEWBOX - spanY * scale) / 2;
  return (point: [number, number] | undefined) => {
    if (!point) return null;
    const [x, y] = point;
    return {
      x: offsetX + (x - minX) * scale,
      y: PREVIEW_VIEWBOX - offsetY - (y - minY) * scale,
    };
  };
}

function polygonPoints(
  face: number[],
  points: Array<[number, number]>,
  project: NonNullable<ReturnType<typeof createPreviewProjection>>
): string | null {
  const projected = face
    .map((vertex) => project(points[vertex]))
    .filter((point): point is { x: number; y: number } => point !== null);
  if (projected.length < 3) return null;
  return projected.map((point) => `${point.x},${point.y}`).join(' ');
}

function assignmentForEdge(document: FoldDocument, edge: number): string {
  return document.edges_assignment?.[edge] ?? 'U';
}
