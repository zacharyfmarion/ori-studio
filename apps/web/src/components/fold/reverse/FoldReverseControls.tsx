import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { FoldReverseKind } from '../../../fold/engine/foldEngineReverseWire';
import type {
  FoldChoiceStepper,
  FoldKindChoice,
  FoldReverseControls,
} from '../../../fold/tools/reverse/reverseToolWindow';
import { Button } from '../../ui/Button';
import { FieldRow } from '../../ui/fieldRows/FieldRow';
import { SegmentedControl } from '../../ui/SegmentedControl';
import styles from './FoldReverseControls.module.css';

/**
 * A compound fold's kind in the Fold tool window: its kinds — a reverse
 * fold's Inside and Outside, a sink's Open and Closed — the one that does
 * not fit disabled with why in its tooltip, and a line saying what fits here.
 */
export function FoldKindChoiceRow<K extends string>({ kind }: { kind: FoldKindChoice<K> }) {
  return (
    <>
      <FieldRow label={kind.label} kind="segmented" divider={false} disabled={kind.disabled}>
        <SegmentedControl<K>
          size="sm"
          aria-label={kind.label}
          value={kind.value}
          disabled={kind.disabled}
          options={kind.options.map((option) => ({
            value: option.value,
            label: option.short,
            disabled: option.disabled,
            tooltip: option.reason ? `${option.label} - ${option.reason}` : option.label,
          }))}
          onChange={kind.set}
        />
      </FieldRow>
      {kind.note && <p className={styles.note}>{kind.note}</p>}
    </>
  );
}

/** The reverse fold's kind in the Fold tool window (`reverseToolWindow`), while both kinds fit. */
export function FoldReverseKindControl({ kind }: { kind: FoldKindChoice<FoldReverseKind> }) {
  return <FoldKindChoiceRow<FoldReverseKind> kind={kind} />;
}

/**
 * A listed choice the folder steps through (`choiceStepper`), in a row:
 * ‹ 2 of 3 ›. Every compound tool's (a tuck's target, the vertex folds' and
 * the sinks' too).
 */
export function FoldChoiceStepperRow({ stepper }: { stepper: FoldChoiceStepper }) {
  return (
    <FieldRow label={stepper.label} kind="static" divider={false}>
      <span className={styles.stepper} data-fold-choice={stepper.label}>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${stepper.label}: ${stepper.previous.label}`}
          title={stepper.previous.label}
          disabled={stepper.previous.disabled}
          onClick={stepper.previous.run}
        >
          <ChevronLeft size={13} aria-hidden="true" />
        </Button>
        <span className={styles.value} aria-live="polite">
          {stepper.value}
        </span>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${stepper.label}: ${stepper.next.label}`}
          title={stepper.next.label}
          disabled={stepper.next.disabled}
          onClick={stepper.next.run}
        >
          <ChevronRight size={13} aria-hidden="true" />
        </Button>
      </span>
    </FieldRow>
  );
}

/** The ways the tip opens and the layer orders it leaves, each a stepper, when there is a choice to make. */
export function FoldReverseChoices({ controls }: { controls: FoldReverseControls }) {
  if (!controls.opening && !controls.order) return null;
  return (
    <>
      {controls.opening && <FoldChoiceStepperRow stepper={controls.opening} />}
      {controls.order && <FoldChoiceStepperRow stepper={controls.order} />}
    </>
  );
}
