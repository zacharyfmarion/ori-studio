import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Layers3, Play, Waves } from 'lucide-react';
import type {
  SequenceInstructionStep,
  SequencePlan,
  SequenceStateSnapshot,
  SequenceStepCertificate,
  SequenceTargetState,
} from '../../engine/types';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { foldedSurfaceFromSequenceState } from '../folded/foldedSurfaceAdapters';
import { FoldedSurfaceSvg } from '../folded/FoldedSurfaceSvg';
import { Button } from '../ui/Button';

const PREVIEW_VIEWBOX = 320;
const PREVIEW_PADDING = 24;
const SEQUENCE_PREVIEW_OPTIONS = { wireframe: false, translucent: false };

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
        const guideCreases = afterState ? guideCreasesForStep(afterState, highlights.creases) : undefined;
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
                guideCreases={guideCreases}
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
  guideCreases,
  stepLabel,
}: {
  title: string;
  state: SequenceStateSnapshot | null | undefined;
  mode: 'paper' | 'folded';
  highlights: SequenceHighlights;
  guideCreases?: ReadonlyMap<number, number>;
  stepLabel?: string;
}) {
  const snapshot = useMemo(() => {
    if (!state) return null;
    return foldedSurfaceFromSequenceState(state, mode);
  }, [mode, state]);
  const activeCreases = useMemo(() => new Set(state?.active_creases ?? []), [state]);
  const highlightedCreases = useMemo(
    () => intersectSets(highlights.creases, activeCreases),
    [activeCreases, highlights.creases]
  );

  if (!state || !snapshot) {
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

  return (
    <div className="sequence-panel__preview">
      <div className="sequence-panel__preview-title">
        <Layers3 size={13} />
        <span>{title}</span>
        <span>{state.id}</span>
      </div>
      <FoldedSurfaceSvg
        snapshot={snapshot}
        viewOptions={SEQUENCE_PREVIEW_OPTIONS}
        ariaLabel={[stepLabel, title, mode === 'folded' ? 'folded state' : 'crease pattern', state.id]
          .filter(Boolean)
          .join(' ')}
        className="sequence-preview-canvas folded-base-canvas"
        surface="sequence-preview"
        viewBoxSize={PREVIEW_VIEWBOX}
        padding={PREVIEW_PADDING}
        guideCreases={guideCreases}
        highlights={{ creases: highlightedCreases }}
      />
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

function intersectSets(a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> {
  const result = new Set<number>();
  a.forEach((value) => {
    if (b.has(value)) result.add(value);
  });
  return result;
}

function guideCreasesForStep(
  state: SequenceStateSnapshot,
  creases: ReadonlySet<number>
): Map<number, number> {
  const guides = new Map<number, number>();
  creases.forEach((crease) => {
    const fold = foldNumberForGuide(state.document.edges_assignment?.[crease]);
    if (fold !== null) guides.set(crease, fold);
  });
  return guides;
}

function foldNumberForGuide(assignment: string | undefined): number | null {
  if (assignment === 'M') return 1;
  if (assignment === 'V') return 2;
  return null;
}
