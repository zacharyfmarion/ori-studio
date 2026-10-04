import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnnotationAction, AnnotationActionId } from '../../diagram/annotate/annotationActions';
import { Button } from '../ui/Button';
import { FieldRow, SegmentedRow } from '../ui/fieldRows';
import { IconButton } from '../ui/IconButton';
import styles from './DiagramPathNodeControls.module.css';

/**
 * Edit Path's node verbs in the Step pane (decision 3), the keyboard's way to
 * shape a fold arrow: step from node to node ("Node 2 of 4"), make the one
 * selected smooth or a corner, add a node after it, take it out. The verbs
 * are the catalog's (`annotationActions.ts`); this only lays them out.
 */
export function DiagramPathNodeControls({
  actions,
  node,
  count,
  keyed,
}: {
  /** The node group of the selected arrow's verbs. */
  actions: readonly AnnotationAction[];
  node: number | null;
  count: number;
  /** A verb's label with the key that runs it, for a tooltip. */
  keyed: (action: AnnotationAction) => string;
}) {
  const { t } = useTranslation();
  const verb = (id: AnnotationActionId) => actions.find((action) => action.id === id);
  const previous = verb('previous-node');
  const next = verb('next-node');
  const smooth = verb('smooth-node');
  const corner = verb('corner-node');
  const add = verb('add-node');
  const remove = verb('delete-node');
  const position =
    node === null
      ? t('panels:diagram.annotations.nodeCount', '{{count}} nodes', {
          count,
          defaultValue_one: '{{count}} node',
        })
      : t('panels:diagram.annotations.nodeOf', 'Node {{number}} of {{total}}', { number: node + 1, total: count });
  const typeOptions = [smooth, corner].filter((action): action is AnnotationAction => action !== undefined);
  const type = typeOptions.find((action) => action.active)?.id ?? null;

  return (
    <>
      <FieldRow label={t('panels:diagram.annotations.node', 'Node')} kind="text">
        <span className={styles.stepper}>
          {previous && (
            <IconButton
              size="sm"
              aria-label={previous.label}
              title={keyed(previous)}
              disabled={previous.disabled}
              onClick={previous.run}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </IconButton>
          )}
          <span className={styles.position} aria-live="polite">
            {position}
          </span>
          {next && (
            <IconButton
              size="sm"
              aria-label={next.label}
              title={keyed(next)}
              disabled={next.disabled}
              onClick={next.run}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </IconButton>
          )}
        </span>
      </FieldRow>
      {typeOptions.length > 0 && (
        <SegmentedRow
          label={t('panels:diagram.annotations.nodeType', 'Type')}
          value={type}
          disabled={typeOptions.every((action) => action.disabled)}
          options={typeOptions.map((action) => ({
            id: action.id,
            label: action.label,
          }))}
          onChange={(id) => typeOptions.find((action) => action.id === id)?.run()}
        />
      )}
      <div className={styles.verbs}>
        {add && (
          <Button size="sm" variant="ghost" disabled={add.disabled} title={keyed(add)} onClick={add.run}>
            <Plus size={14} aria-hidden="true" />
            {add.label}
          </Button>
        )}
        {remove && (
          <Button size="sm" variant="ghost" disabled={remove.disabled} title={keyed(remove)} onClick={remove.run}>
            <Minus size={14} aria-hidden="true" />
            {remove.label}
          </Button>
        )}
      </div>
    </>
  );
}
