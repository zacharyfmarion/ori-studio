import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileQuestionMark,
  FileText,
  FolderOpen,
  Link2,
  LockKeyhole,
  Plus,
  Ruler,
  ScanLine,
  Trash2,
} from 'lucide-react';
import { handleMenuAction } from '../../commands/menuActions';
import type { ConditionKind } from '../../engine/types';
import type { TreeCondition } from '../../lib/sampleProject';
import { conditionDetail, conditionTitle } from '../../lib/conditionLabels';
import {
  isConditionSelected,
  selectedConditionIds,
  selectedEdgeIds,
  selectedNodeIds,
  selectedPathIds,
  toggleConditionSelection,
} from '../../lib/selection';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Button } from '../ui/Button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip';

export function ConditionsPanel() {
  const { t } = useTranslation();
  const project = useWorkspaceStore((state) => state.project);
  const importedCreasePattern = useWorkspaceStore((state) => state.importedCreasePattern);
  const selection = useWorkspaceStore((state) => state.selection);
  const select = useWorkspaceStore((state) => state.select);
  const updatePaper = useWorkspaceStore((state) => state.updatePaper);
  const addCondition = useWorkspaceStore((state) => state.addCondition);
  const updateCondition = useWorkspaceStore((state) => state.updateCondition);
  const deleteCondition = useWorkspaceStore((state) => state.deleteCondition);
  const deleteConditionsForSelectedNodes = useWorkspaceStore((state) => state.deleteConditionsForSelectedNodes);
  const deleteConditionsForSelectedEdges = useWorkspaceStore((state) => state.deleteConditionsForSelectedEdges);
  const deleteConditionsForSelectedPaths = useWorkspaceStore((state) => state.deleteConditionsForSelectedPaths);
  const clearConditions = useWorkspaceStore((state) => state.clearConditions);
  const nodeIds = selectedNodeIds(selection);
  const edgeIds = selectedEdgeIds(selection);
  const conditionIds = selectedConditionIds(selection);
  const pathIds = selectedPathIds(selection);
  const selectedNode = nodeIds.length === 1 ? project.nodes.find((node) => node.id === nodeIds[0]) : null;
  const selectedEdge = edgeIds.length === 1 ? project.edges.find((edge) => edge.id === edgeIds[0]) : null;
  const selectedPath =
    selection.kind === 'path' ? project.paths.find((path) => path.id === selection.id) : null;
  const editedCondition =
    conditionIds.length === 1
      ? project.conditions.find((condition) => condition.id === conditionIds[0])
      : null;
  const [angle, setAngle] = useState(0);
  const [quant, setQuant] = useState(4);
  const [quantOffset, setQuantOffset] = useState(0);

  const selectedLeafNodeIds = useMemo(
    () =>
      nodeIds.filter((id) => {
        const node = project.nodes.find((candidate) => candidate.id === id);
        return node?.isLeaf;
      }),
    [nodeIds, project.nodes]
  );

  const add = (kind: ConditionKind) => {
    void addCondition(kind);
  };

  if (importedCreasePattern) {
    return (
      <section className="panel-shell conditions-panel">
        <div className="panel-body document-mode-empty">
          <div className="document-mode-empty__icon" aria-hidden="true">
            <FileQuestionMark size={30} />
          </div>
          <span className="document-mode-empty__message">
            {t(
              'panels:conditions.imported.message',
              'Imported crease patterns do not have editable tree conditions.'
            )}
          </span>
          <div className="document-mode-empty__actions">
            <Button size="sm" variant="primary" onClick={() => void handleMenuAction('view.edit')}>
              <ScanLine size={14} />
              {t('panels:documentModeEmpty.editCp', 'Edit CP')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleMenuAction('file.new')}>
              <FileText size={14} />
              {t('panels:documentModeEmpty.newTree', 'New Tree')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleMenuAction('file.open')}>
              <FolderOpen size={14} />
              {t('panels:documentModeEmpty.open', 'Open')}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-shell conditions-panel">
      <div className="panel-toolbar panel-toolbar--actions-only">
        <button
          className="toolbar-text-button"
          type="button"
          disabled={project.conditions.length === 0}
          onClick={() => void clearConditions()}
        >
          {t('panels:conditions.clear', 'Clear')}
        </button>
      </div>
      <div className="panel-body conditions-panel__body">
        <section className="condition-section">
          <div className="condition-section__title">{t('panels:conditions.paper.title', 'Paper')}</div>
          <NumberControl
            label={t('panels:conditions.paper.width', 'Width')}
            value={project.paper.width}
            min={0.1}
            step={0.05}
            onCommit={(width) => void updatePaper({ width })}
          />
          <NumberControl
            label={t('panels:conditions.paper.height', 'Height')}
            value={project.paper.height}
            min={0.1}
            step={0.05}
            onCommit={(height) => void updatePaper({ height })}
          />
        </section>

        <section className="condition-section">
          <div className="condition-section__title">
            {t('panels:conditions.addFromSelection.title', 'Add From Selection')}
          </div>
          <div className="condition-actions">
            <ConditionAction
              icon={<LockKeyhole size={14} />}
              label={t('panels:conditions.actions.fixNode.label', 'Fix node')}
              help={t(
                'panels:conditions.actions.fixNode.help',
                "Select one leaf node. Adds a fixed-position condition at the node's current coordinates."
              )}
              disabled={!selectedNode?.isLeaf}
              onClick={() =>
                selectedNode &&
                add({
                  type: 'node_fixed',
                  node: selectedNode.id,
                  x_fixed: true,
                  y_fixed: true,
                  x_fix_value: selectedNode.loc.x,
                  y_fix_value: selectedNode.loc.y,
                })
              }
            />
            <ConditionAction
              icon={<Ruler size={14} />}
              label={t('panels:conditions.actions.nodeOnEdge.label', 'Node on edge')}
              help={t(
                'panels:conditions.actions.nodeOnEdge.help',
                'Select one leaf node. Constrains it to lie somewhere on the paper boundary.'
              )}
              disabled={!selectedNode?.isLeaf}
              onClick={() => selectedNode && add({ type: 'node_on_edge', node: selectedNode.id })}
            />
            <ConditionAction
              icon={<Ruler size={14} />}
              label={t('panels:conditions.actions.nodeOnCorner.label', 'Node on corner')}
              help={t(
                'panels:conditions.actions.nodeOnCorner.help',
                'Select one leaf node. Constrains it to one of the paper corners.'
              )}
              disabled={!selectedNode?.isLeaf}
              onClick={() => selectedNode && add({ type: 'node_on_corner', node: selectedNode.id })}
            />
            <ConditionAction
              icon={<Link2 size={14} />}
              label={t('panels:conditions.actions.nodeOnSymmetry.label', 'Node on symmetry')}
              help={t(
                'panels:conditions.actions.nodeOnSymmetry.help',
                'Enable symmetry and select one leaf node. Constrains the node to the active symmetry line.'
              )}
              disabled={!selectedNode?.isLeaf || !project.hasSymmetry}
              onClick={() => selectedNode && add({ type: 'node_symmetric', node: selectedNode.id })}
            />
            <ConditionAction
              icon={<Link2 size={14} />}
              label={t('panels:conditions.actions.pairNodes.label', 'Pair nodes')}
              help={t(
                'panels:conditions.actions.pairNodes.help',
                'Select two leaf nodes. Keeps the pair mirrored across the active symmetry line.'
              )}
              disabled={selectedLeafNodeIds.length !== 2}
              onClick={() =>
                add({
                  type: 'nodes_paired',
                  node1: selectedLeafNodeIds[0],
                  node2: selectedLeafNodeIds[1],
                })
              }
            />
            <ConditionAction
              icon={<Link2 size={14} />}
              label="Collinear nodes"
              help="Select three leaf nodes. Constrains them to stay on a common line."
              disabled={selectedLeafNodeIds.length !== 3}
              onClick={() =>
                add({
                  type: 'nodes_collinear',
                  node1: selectedLeafNodeIds[0],
                  node2: selectedLeafNodeIds[1],
                  node3: selectedLeafNodeIds[2],
                })
              }
            />
            <ConditionAction
              icon={<LockKeyhole size={14} />}
              label="Fix edge length"
              help="Select one edge. Locks that edge's current tree length during optimization."
              disabled={!selectedEdge}
              onClick={() => selectedEdge && add({ type: 'edge_length_fixed', edge: selectedEdge.id })}
            />
            <ConditionAction
              icon={<Link2 size={14} />}
              label="Same strain"
              help="Select two edges. Constrains both edges to use the same strain value."
              disabled={edgeIds.length !== 2}
              onClick={() => add({ type: 'edges_same_strain', edge1: edgeIds[0], edge2: edgeIds[1] })}
            />
            <ConditionAction
              icon={<Plus size={14} />}
              label="Active path"
              help="Select a leaf path. Marks that path as active for optimization and crease-pattern construction."
              disabled={!selectedPath}
              onClick={() =>
                selectedPath &&
                add({ type: 'path_active', node1: selectedPath.nodes[0], node2: selectedPath.nodes[1] })
              }
            />
          </div>
          {selectedPath && (
            <div className="condition-path-controls">
              <NumberControl label="Angle" value={angle} step={1} onCommit={setAngle} />
              <ConditionAction
                icon={<Plus size={14} />}
                label="Fix angle"
                help="Uses the selected path and Angle value to add a fixed path-angle condition."
                onClick={() =>
                  add({
                    type: 'path_angle_fixed',
                    node1: selectedPath.nodes[0],
                    node2: selectedPath.nodes[1],
                    angle,
                  })
                }
              />
              <NumberControl label="Quant" value={quant} min={1} step={1} onCommit={setQuant} />
              <NumberControl label="Offset" value={quantOffset} step={1} onCommit={setQuantOffset} />
              <ConditionAction
                icon={<Plus size={14} />}
                label="Quantize"
                help="Uses the selected path plus Quant and Offset values to constrain the angle to a quantized family."
                onClick={() =>
                  add({
                    type: 'path_angle_quant',
                    node1: selectedPath.nodes[0],
                    node2: selectedPath.nodes[1],
                    quant,
                    quant_offset: quantOffset,
                  })
                }
              />
            </div>
          )}
          <div className="condition-actions">
            <ConditionAction
              icon={<Trash2 size={14} />}
              label="Remove node conditions"
              help="Select one or more nodes. Removes every condition that references those nodes."
              disabled={nodeIds.length === 0}
              onClick={() => void deleteConditionsForSelectedNodes()}
            />
            <ConditionAction
              icon={<Trash2 size={14} />}
              label="Remove edge conditions"
              help="Select one or more edges. Removes every condition that references those edges."
              disabled={edgeIds.length === 0}
              onClick={() => void deleteConditionsForSelectedEdges()}
            />
            <ConditionAction
              icon={<Trash2 size={14} />}
              label="Remove path conditions"
              help="Select one or more paths. Removes every path condition that references those paths."
              disabled={pathIds.length === 0}
              onClick={() => void deleteConditionsForSelectedPaths()}
            />
          </div>
        </section>

        {editedCondition && (
          <section className="condition-section">
            <div className="condition-section__title">Editor</div>
            <ConditionEditor
              condition={editedCondition}
              onUpdate={(kind) => void updateCondition(editedCondition.id, kind)}
            />
          </section>
        )}

        <section className="condition-section">
          <div className="condition-section__title">List</div>
          {project.conditions.length === 0 ? (
            <div className="empty-note">No conditions</div>
          ) : (
            <div className="condition-list">
              {project.conditions.map((condition) => (
                <button
                  className="condition-item"
                  data-active={isConditionSelected(selection, condition.id) || undefined}
                  data-feasible={condition.isFeasible || undefined}
                  key={condition.id}
                  type="button"
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      select(toggleConditionSelection(selection, condition.id));
                      return;
                    }
                    select({ kind: 'condition', id: condition.id });
                  }}
                >
                  <span>
                    <strong>{conditionTitle(condition.kind)}</strong>
                    <small>{conditionDetail(condition.kind)}</small>
                  </span>
                  <Trash2
                    size={14}
                    role="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteCondition(condition.id);
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function ConditionEditor({
  condition,
  onUpdate,
}: {
  condition: TreeCondition;
  onUpdate: (kind: ConditionKind) => void;
}) {
  const kind = condition.kind;
  const update = (patch: Partial<ConditionKind>) => onUpdate({ ...kind, ...patch } as ConditionKind);
  const updateInt = (key: string, value: number) => update({ [key]: Math.max(1, Math.round(value)) } as Partial<ConditionKind>);
  const updateNumber = (key: string, value: number) => update({ [key]: value } as Partial<ConditionKind>);
  const updateBool = (key: string, value: boolean) => update({ [key]: value } as Partial<ConditionKind>);

  switch (kind.type) {
    case 'node_combo':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node" value={kind.node} min={1} step={1} onCommit={(value) => updateInt('node', value)} />
          <ToggleControl label="Sym line" checked={kind.to_symmetry_line} onChange={(value) => updateBool('to_symmetry_line', value)} />
          <ToggleControl label="Paper edge" checked={kind.to_paper_edge} onChange={(value) => updateBool('to_paper_edge', value)} />
          <ToggleControl label="Corner" checked={kind.to_paper_corner} onChange={(value) => updateBool('to_paper_corner', value)} />
          <ToggleControl label="Fix X" checked={kind.x_fixed} onChange={(value) => updateBool('x_fixed', value)} />
          <NumberControl label="X" value={kind.x_fix_value} step={0.01} onCommit={(value) => updateNumber('x_fix_value', value)} />
          <ToggleControl label="Fix Y" checked={kind.y_fixed} onChange={(value) => updateBool('y_fixed', value)} />
          <NumberControl label="Y" value={kind.y_fix_value} step={0.01} onCommit={(value) => updateNumber('y_fix_value', value)} />
        </div>
      );
    case 'node_fixed':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node" value={kind.node} min={1} step={1} onCommit={(value) => updateInt('node', value)} />
          <ToggleControl label="Fix X" checked={kind.x_fixed} onChange={(value) => updateBool('x_fixed', value)} />
          <NumberControl label="X" value={kind.x_fix_value} step={0.01} onCommit={(value) => updateNumber('x_fix_value', value)} />
          <ToggleControl label="Fix Y" checked={kind.y_fixed} onChange={(value) => updateBool('y_fixed', value)} />
          <NumberControl label="Y" value={kind.y_fix_value} step={0.01} onCommit={(value) => updateNumber('y_fix_value', value)} />
        </div>
      );
    case 'node_on_corner':
    case 'node_on_edge':
    case 'node_symmetric':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node" value={kind.node} min={1} step={1} onCommit={(value) => updateInt('node', value)} />
        </div>
      );
    case 'nodes_paired':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node 1" value={kind.node1} min={1} step={1} onCommit={(value) => updateInt('node1', value)} />
          <NumberControl label="Node 2" value={kind.node2} min={1} step={1} onCommit={(value) => updateInt('node2', value)} />
        </div>
      );
    case 'nodes_collinear':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node 1" value={kind.node1} min={1} step={1} onCommit={(value) => updateInt('node1', value)} />
          <NumberControl label="Node 2" value={kind.node2} min={1} step={1} onCommit={(value) => updateInt('node2', value)} />
          <NumberControl label="Node 3" value={kind.node3} min={1} step={1} onCommit={(value) => updateInt('node3', value)} />
        </div>
      );
    case 'edge_length_fixed':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Edge" value={kind.edge} min={1} step={1} onCommit={(value) => updateInt('edge', value)} />
        </div>
      );
    case 'edges_same_strain':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Edge 1" value={kind.edge1} min={1} step={1} onCommit={(value) => updateInt('edge1', value)} />
          <NumberControl label="Edge 2" value={kind.edge2} min={1} step={1} onCommit={(value) => updateInt('edge2', value)} />
        </div>
      );
    case 'path_combo':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node 1" value={kind.node1} min={1} step={1} onCommit={(value) => updateInt('node1', value)} />
          <NumberControl label="Node 2" value={kind.node2} min={1} step={1} onCommit={(value) => updateInt('node2', value)} />
          <ToggleControl label="Fix angle" checked={kind.is_angle_fixed} onChange={(value) => updateBool('is_angle_fixed', value)} />
          <NumberControl label="Angle" value={kind.angle} step={1} onCommit={(value) => updateNumber('angle', value)} />
          <ToggleControl label="Quantize" checked={kind.is_angle_quant} onChange={(value) => updateBool('is_angle_quant', value)} />
          <NumberControl label="Quant" value={kind.quant} min={1} step={1} onCommit={(value) => updateInt('quant', value)} />
          <NumberControl label="Offset" value={kind.quant_offset} step={1} onCommit={(value) => updateNumber('quant_offset', value)} />
        </div>
      );
    case 'path_active':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node 1" value={kind.node1} min={1} step={1} onCommit={(value) => updateInt('node1', value)} />
          <NumberControl label="Node 2" value={kind.node2} min={1} step={1} onCommit={(value) => updateInt('node2', value)} />
        </div>
      );
    case 'path_angle_fixed':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node 1" value={kind.node1} min={1} step={1} onCommit={(value) => updateInt('node1', value)} />
          <NumberControl label="Node 2" value={kind.node2} min={1} step={1} onCommit={(value) => updateInt('node2', value)} />
          <NumberControl label="Angle" value={kind.angle} step={1} onCommit={(value) => updateNumber('angle', value)} />
        </div>
      );
    case 'path_angle_quant':
      return (
        <div className="condition-advanced__body">
          <NumberControl label="Node 1" value={kind.node1} min={1} step={1} onCommit={(value) => updateInt('node1', value)} />
          <NumberControl label="Node 2" value={kind.node2} min={1} step={1} onCommit={(value) => updateInt('node2', value)} />
          <NumberControl label="Quant" value={kind.quant} min={1} step={1} onCommit={(value) => updateInt('quant', value)} />
          <NumberControl label="Offset" value={kind.quant_offset} step={1} onCommit={(value) => updateNumber('quant_offset', value)} />
        </div>
      );
  }
}

function ConditionAction({
  icon,
  label,
  help,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  help: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = (
    <button className="condition-action" type="button" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="condition-action-tooltip-trigger" data-disabled={disabled || undefined}>
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{help}</TooltipContent>
    </Tooltip>
  );
}

function NumberControl({
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
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const lowerBounded = min === undefined ? parsed : Math.max(min, parsed);
    const next = max === undefined ? lowerBounded : Math.min(max, lowerBounded);
    if (Math.abs(next - value) > 0.000_001) onCommit(next);
    setDraft(String(next));
  };

  return (
    <label className="condition-number">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="condition-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
