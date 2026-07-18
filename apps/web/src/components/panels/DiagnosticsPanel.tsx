import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';

export function DiagnosticsPanel() {
  const { t } = useTranslation();
  const project = useWorkspaceStore((state) => state.project);
  const status = useWorkspaceStore((state) => state.status);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const error = useWorkspaceStore((state) => state.error);
  const lastOptimization = useWorkspaceStore((state) => state.lastOptimization);

  const cpReady = project.creases.length > 0 && project.facets.length > 0;
  const infeasibleConditions = project.conditions.filter((condition) => !condition.isFeasible);
  const conditionedNodes = project.nodes.filter((node) => node.isConditioned).length;
  const conditionedEdges = project.edges.filter((edge) => edge.isConditioned).length;
  const conditionedPaths = project.paths.filter((path) => path.isConditioned).length;
  const optimizationTone = lastOptimization?.is_feasible
    ? 'good'
    : lastOptimization
      ? 'bad'
      : 'warn';
  const engineIcon = error ? (
    <AlertTriangle size={15} />
  ) : engineReady ? (
    <CheckCircle2 size={15} />
  ) : (
    <CircleDashed size={15} />
  );

  return (
    <section className="panel-shell">
      <div className="panel-body">
        <div className="metric-grid">
          <Metric label={t('panels:diagnostics.nodes', 'Nodes')} value={project.nodes.length} />
          <Metric label={t('panels:diagnostics.edges', 'Edges')} value={project.edges.length} />
          <Metric label={t('panels:diagnostics.paths', 'Paths')} value={project.paths.length} />
          <Metric label={t('panels:diagnostics.conditions', 'Conditions')} value={project.conditions.length} />
        </div>
        <div className="status-row" data-tone={error ? 'bad' : engineReady ? 'good' : 'warn'}>
          {engineIcon}
          <span>
            {error
              ? error.message
              : engineReady
                ? t('panels:diagnostics.engineReady', 'Engine ready')
                : t('panels:diagnostics.loadingEngine', 'Loading engine')}
          </span>
        </div>
        <div className="status-row" data-tone={optimizationTone}>
          {lastOptimization?.is_feasible ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
          <span>
            {lastOptimization
              ? lastOptimization.message
              : status === 'optimizing'
                ? t('panels:diagnostics.optimizingScale', 'Optimizing scale')
                : t('panels:diagnostics.optimizationPending', 'Optimization pending')}
          </span>
        </div>
        <div className="status-row" data-tone={infeasibleConditions.length === 0 ? 'good' : 'bad'}>
          {infeasibleConditions.length === 0 ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>
            {infeasibleConditions.length === 0
              ? t('panels:diagnostics.allConditionsFeasible', 'All conditions feasible')
              : infeasibleConditions.length === 1
                ? t('panels:diagnostics.infeasibleConditionOne', '{{count}} infeasible condition: {{ids}}', {
                    count: infeasibleConditions.length,
                    ids: infeasibleConditions.map((condition) => condition.id).join(', '),
                  })
                : t('panels:diagnostics.infeasibleConditionOther', '{{count}} infeasible conditions: {{ids}}', {
                    count: infeasibleConditions.length,
                    ids: infeasibleConditions
                      .slice(0, 3)
                      .map((condition) => condition.id)
                      .join(', '),
                  })}
          </span>
        </div>
        <div className="status-row" data-tone="warn">
          <CircleDashed size={15} />
          <span>
            {t(
              'panels:diagnostics.conditionedParts',
              'Conditioned parts: {{nodes}} nodes, {{edges}} edges, {{paths}} paths',
              { nodes: conditionedNodes, edges: conditionedEdges, paths: conditionedPaths }
            )}
          </span>
        </div>
        {lastOptimization && !lastOptimization.is_feasible && (
          <div className="status-row" data-tone="bad">
            <AlertTriangle size={15} />
            <span>
              {t(
                'panels:diagnostics.optimizerInfeasible',
                'Optimizer reported an infeasible constrained system'
              )}
            </span>
          </div>
        )}
        <div className="status-row" data-tone={cpReady ? 'good' : 'warn'}>
          {cpReady ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
          <span>
            {cpReady
              ? t('panels:diagnostics.creasesFacets', '{{creases}} creases, {{facets}} facets', {
                  creases: project.creases.length,
                  facets: project.facets.length,
                })
              : status === 'building_crease_pattern'
                ? t('panels:diagnostics.buildingCreasePattern', 'Building crease pattern')
                : t('panels:diagnostics.creasePatternPending', 'Crease pattern pending')}
          </span>
        </div>
      </div>
    </section>
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
