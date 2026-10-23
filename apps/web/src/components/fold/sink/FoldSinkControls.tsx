import type { FoldSinkKind } from '../../../fold/engine/foldEngineSinkWire';
import type { FoldSinkControls } from '../../../fold/tools/sink/sinkToolWindow';
import { FieldRow } from '../../ui/fieldRows/FieldRow';
import { FoldChoiceStepperRow, FoldKindChoiceRow } from '../reverse/FoldReverseControls';
import styles from './FoldSinkControls.module.css';

/**
 * A sink's kind and its line in the Fold tool window (`sinkToolWindow`):
 * Open and Closed while there is a choice, the one that does not fit
 * disabled with why in its tooltip; and the depth the line sinks the point
 * to.
 */
export function FoldSinkLine({ controls }: { controls: FoldSinkControls }) {
  const { kind, depth } = controls;
  if (!kind && !depth) return null;
  return (
    <>
      {kind && <FoldKindChoiceRow<FoldSinkKind> kind={kind} />}
      {depth && (
        <FieldRow label={depth.label} kind="static" help={depth.help} divider={false}>
          <span className={styles.depth} data-fold-sink-depth="">
            {depth.value}
          </span>
        </FieldRow>
      )}
    </>
  );
}

/** The pocket a closed sink goes into and the layer order it leaves, each a stepper, when there is a choice. */
export function FoldSinkChoices({ controls }: { controls: FoldSinkControls }) {
  if (!controls.pocket && !controls.order) return null;
  return (
    <>
      {controls.pocket && <FoldChoiceStepperRow stepper={controls.pocket} />}
      {controls.order && <FoldChoiceStepperRow stepper={controls.order} />}
    </>
  );
}
