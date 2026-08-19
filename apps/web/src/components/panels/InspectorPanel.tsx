import { selectProject, selectSelection } from '../../store/workspaceStore/designTabs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Circle, GitBranch, MousePointer2, Square, Waypoints } from 'lucide-react';
import { handleMenuAction } from '../../commands/menuActions';
import { formatNumber } from '../../lib/geometry';
import { conditionDetail, conditionTitle } from '../../lib/conditionLabels';
import { selectedNodeIds, selectionSummary } from '../../lib/selection';
import { useWorkspaceStore } from '../../store/workspaceStore';

export function InspectorPanel() {
  const { t } = useTranslation();
  const project = useWorkspaceStore((state) => selectProject(state));
  const selection = useWorkspaceStore((state) => selectSelection(state));
  const moveNode = useWorkspaceStore((state) => state.moveNode);
  const updateNodeLabel = useWorkspaceStore((state) => state.updateNodeLabel);
  const updateEdge = useWorkspaceStore((state) => state.updateEdge);
  const selectPathBetweenSelectedNodes = useWorkspaceStore(
    (state) => state.selectPathBetweenSelectedNodes,
  );

  const selectedNode =
    selection.kind === 'node' ? project.nodes.find((node) => node.id === selection.id) : null;
  const selectedEdge =
    selection.kind === 'edge' ? project.edges.find((edge) => edge.id === selection.id) : null;
  const selectedCondition =
    selection.kind === 'condition'
      ? project.conditions.find((condition) => condition.id === selection.id)
      : null;
  const selectedPath =
    selection.kind === 'path' ? project.paths.find((path) => path.id === selection.id) : null;
  const selectedNodes = selectedNodeIds(selection);

  const yesNo = (value: boolean) =>
    value ? t('panels:inspector.yes', 'Yes') : t('panels:inspector.no', 'No');

  return (
    <section className="panel-shell inspector-panel">
      <div className="panel-body">
        {selectedNode && (
          <>
            <div className="inspector-heading">
              <Circle size={15} />{' '}
              {t('panels:inspector.node', 'Node {{id}}', { id: selectedNode.id })}
            </div>
            <EditableRow
              label={t('panels:inspector.label', 'Label')}
              value={selectedNode.label}
              onCommit={(label) => void updateNodeLabel(selectedNode.id, label)}
            />
            <NumberRow
              label={t('panels:inspector.x', 'X')}
              value={selectedNode.loc.x}
              min={0}
              max={1}
              step={0.01}
              onCommit={(x) => void moveNode(selectedNode.id, { ...selectedNode.loc, x })}
            />
            <NumberRow
              label={t('panels:inspector.y', 'Y')}
              value={selectedNode.loc.y}
              min={0}
              max={1}
              step={0.01}
              onCommit={(y) => void moveNode(selectedNode.id, { ...selectedNode.loc, y })}
            />
            <Row label={t('panels:inspector.leaf', 'Leaf')} value={yesNo(selectedNode.isLeaf)} />
            <Row
              label={t('panels:inspector.pinned', 'Pinned')}
              value={yesNo(selectedNode.isPinned)}
            />
            <Row
              label={t('panels:inspector.conditioned', 'Conditioned')}
              value={yesNo(selectedNode.isConditioned)}
            />
            <ActionRow
              label={t('panels:inspector.makeRoot', 'Make Root')}
              onClick={() => void handleMenuAction('edit.makeRoot')}
            />
            <ActionRow
              label={t('panels:inspector.perturb', 'Perturb')}
              onClick={() => void handleMenuAction('edit.perturbNodes')}
            />
          </>
        )}
        {selectedEdge && (
          <>
            <div className="inspector-heading">
              <GitBranch size={15} />{' '}
              {t('panels:inspector.edge', 'Edge {{id}}', { id: selectedEdge.id })}
            </div>
            <EditableRow
              label={t('panels:inspector.label', 'Label')}
              value={selectedEdge.label}
              onCommit={(label) => void updateEdge(selectedEdge.id, { label })}
            />
            <Row
              label={t('panels:inspector.nodes', 'Nodes')}
              value={selectedEdge.nodes.join(' -> ')}
            />
            <NumberRow
              label={t('panels:inspector.length', 'Length')}
              value={selectedEdge.length}
              min={0.001}
              step={0.05}
              onCommit={(length) => void updateEdge(selectedEdge.id, { length })}
            />
            <Row
              label={t('panels:inspector.strain', 'Strain')}
              value={formatNumber(selectedEdge.strain)}
            />
            <Row
              label={t('panels:inspector.conditioned', 'Conditioned')}
              value={yesNo(selectedEdge.isConditioned)}
            />
            <NumberRow
              label={t('panels:inspector.stiffness', 'Stiffness')}
              value={selectedEdge.stiffness}
              min={0.001}
              step={0.1}
              onCommit={(stiffness) => void updateEdge(selectedEdge.id, { stiffness })}
            />
            <ActionRow
              label={t('panels:inspector.split', 'Split')}
              onClick={() => void handleMenuAction('edit.splitEdge')}
            />
            <ActionRow
              label={t('panels:inspector.renormalize', 'Renormalize')}
              onClick={() => void handleMenuAction('edit.renormalizeToEdge')}
            />
            <ActionRow
              label={t('panels:inspector.removeStrain', 'Remove strain')}
              onClick={() => void handleMenuAction('edit.removeStrain')}
            />
            <ActionRow
              label={t('panels:inspector.relieveStrain', 'Relieve strain')}
              onClick={() => void handleMenuAction('edit.relieveStrain')}
            />
          </>
        )}
        {selectedPath && (
          <>
            <div className="inspector-heading">
              <Waypoints size={15} />{' '}
              {t('panels:inspector.path', 'Path {{id}}', { id: selectedPath.id })}
            </div>
            <Row
              label={t('panels:inspector.nodes', 'Nodes')}
              value={selectedPath.nodes.join(' -> ')}
            />
            <Row label={t('panels:inspector.leaf', 'Leaf')} value={yesNo(selectedPath.isLeaf)} />
            <Row
              label={t('panels:inspector.active', 'Active')}
              value={yesNo(selectedPath.isActive)}
            />
            <Row
              label={t('panels:inspector.feasible', 'Feasible')}
              value={yesNo(selectedPath.isFeasible)}
            />
            <Row
              label={t('panels:inspector.border', 'Border')}
              value={yesNo(selectedPath.isBorder)}
            />
            <Row
              label={t('panels:inspector.polygon', 'Polygon')}
              value={yesNo(selectedPath.isPolygon)}
            />
            <Row
              label={t('panels:inspector.conditioned', 'Conditioned')}
              value={yesNo(selectedPath.isConditioned)}
            />
          </>
        )}
        {selectedCondition && (
          <>
            <div className="inspector-heading">
              <Activity size={15} />{' '}
              {t('panels:inspector.condition', 'Condition {{id}}', { id: selectedCondition.id })}
            </div>
            <Row
              label={t('panels:inspector.type', 'Type')}
              value={conditionTitle(selectedCondition.kind)}
            />
            <Row
              label={t('panels:inspector.detail', 'Detail')}
              value={conditionDetail(selectedCondition.kind)}
            />
            <Row
              label={t('panels:inspector.feasible', 'Feasible')}
              value={yesNo(selectedCondition.isFeasible)}
            />
          </>
        )}
        {selection.kind === 'multi' && (
          <>
            <div className="inspector-heading">
              <MousePointer2 size={15} /> {t('panels:inspector.selection', 'Selection')}
            </div>
            <Row label={t('panels:inspector.parts', 'Parts')} value={selectionSummary(selection)} />
            {selectedNodes.length === 2 && (
              <button
                className="control-row control-row--button"
                type="button"
                onClick={selectPathBetweenSelectedNodes}
              >
                <span className="control-row__label">
                  {t('panels:inspector.pathLabel', 'Path')}
                </span>
                <span className="control-row__value">
                  {t('panels:inspector.selectBetweenNodes', 'Select between nodes')}
                </span>
              </button>
            )}
            <ActionRow
              label={t('panels:inspector.absorbNodes', 'Absorb nodes')}
              onClick={() => void handleMenuAction('edit.absorbNodes')}
            />
            <ActionRow
              label={t('panels:inspector.perturbNodes', 'Perturb nodes')}
              onClick={() => void handleMenuAction('edit.perturbNodes')}
            />
          </>
        )}
        {selection.kind === 'tree' && (
          <>
            <div className="inspector-heading">
              <Square size={15} /> {t('panels:inspector.tree', 'Tree')}
            </div>
            <Row label={t('panels:inspector.title', 'Title')} value={project.title} />
            <Row
              label={t('panels:inspector.paper', 'Paper')}
              value={`${project.paper.width} x ${project.paper.height}`}
            />
            <Row label={t('panels:inspector.scale', 'Scale')} value={formatNumber(project.scale)} />
            <Row
              label={t('panels:inspector.nodes', 'Nodes')}
              value={String(project.nodes.length)}
            />
            <Row
              label={t('panels:inspector.edges', 'Edges')}
              value={String(project.edges.length)}
            />
            <Row
              label={t('panels:inspector.creases', 'Creases')}
              value={String(project.creases.length)}
            />
            <Row
              label={t('panels:inspector.conditions', 'Conditions')}
              value={String(project.conditions.length)}
            />
            <ActionRow
              label={t('panels:inspector.absorbRedundantNodes', 'Absorb redundant nodes')}
              onClick={() => void handleMenuAction('edit.absorbRedundantNodes')}
            />
            <ActionRow
              label={t('panels:inspector.renormalizeUnitScale', 'Renormalize unit scale')}
              onClick={() => void handleMenuAction('edit.renormalizeToUnitScale')}
            />
            <ActionRow
              label={t('panels:inspector.removeAllStrain', 'Remove all strain')}
              onClick={() => void handleMenuAction('edit.removeAllStrain')}
            />
            <ActionRow
              label={t('panels:inspector.relieveAllStrain', 'Relieve all strain')}
              onClick={() => void handleMenuAction('edit.relieveAllStrain')}
            />
          </>
        )}
      </div>
    </section>
  );
}

function ActionRow({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button className="control-row control-row--button" type="button" onClick={onClick}>
      <span className="control-row__label">{t('panels:inspector.action', 'Action')}</span>
      <span className="control-row__value">{label}</span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="control-row">
      <span className="control-row__label">{label}</span>
      <span className="control-row__value">{value}</span>
    </div>
  );
}

function EditableRow({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <label className="control-row">
      <span className="control-row__label">{label}</span>
      <input
        className="control-row__input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(formatNumber(value, 4));

  useEffect(() => {
    setDraft(formatNumber(value, 4));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumber(value, 4));
      return;
    }
    const lowerBounded = min === undefined ? parsed : Math.max(min, parsed);
    const next = max === undefined ? lowerBounded : Math.min(max, lowerBounded);
    if (Math.abs(next - value) > 0.000_001) onCommit(next);
    setDraft(formatNumber(next, 4));
  };

  return (
    <label className="control-row">
      <span className="control-row__label">{label}</span>
      <input
        className="control-row__input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(formatNumber(value, 4));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
