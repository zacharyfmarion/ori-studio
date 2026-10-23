import { FoldOrderStacks } from './orders/FoldOrderStacks';
import type { FoldOrderInspection } from '../../fold/orders/useFoldOrderInspection';
import { FoldOrderChooser } from './orders/FoldOrderChooser';
import type { FoldOrderResolution } from '../../fold/orders/useFoldOrderResolution';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, RotateCcw, RotateCw } from 'lucide-react';
import type { TurnDirection, TurnRotationPreset } from '../../lib/steps/turn';
import {
  FOLD_TOOL_SHORTCUTS,
  type FoldKeyLabel,
  type FoldKind,
  type FoldShortcutId,
  type FoldToolId,
} from '../../fold/tools/foldToolCatalog';
import type { FoldToolWindowModel } from '../../fold/tools/foldToolWindow';
import type { FoldExtentMode } from '../../fold/tools/precrease/precreaseExtent';
import type { FoldKindChoice } from '../../fold/tools/reverse/reverseToolWindow';
import { STORAGE_KEYS } from '../../lib/storage';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { Button } from '../ui/Button';
import { FloatingPanelDock } from '../ui/FloatingPanel';
import { FieldRow } from '../ui/fieldRows/FieldRow';
import { NumberRow } from '../ui/fieldRows/NumberRow';
import { SegmentedRow } from '../ui/fieldRows/SegmentedRow';
import { SelectRow } from '../ui/fieldRows/SelectRow';
import { TextRow } from '../ui/fieldRows/TextRow';
import { ToggleRow } from '../ui/fieldRows/ToggleRow';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ToolHintInstructions } from '../ui/tools/ToolHintInstructions';
import { ToolHintWindow } from '../ui/tools/ToolHintWindow';
import { FoldCrossSectionPicker } from './FoldCrossSectionPicker';
import { FoldFlapChips } from './FoldFlapChips';
import { FoldKindMark } from './FoldKindMark';
import { FoldRefusalNotice } from './FoldRefusalNotice';
import { FoldChoiceStepperRow, FoldReverseChoices, FoldReverseKindControl } from './reverse/FoldReverseControls';
import { FoldSinkChoices, FoldSinkLine } from './sink/FoldSinkControls';
import { hasVertexChoices } from '../../fold/tools/vertex/vertexToolWindow';
import { FoldVertexChoices, FoldVertexDirection } from './vertex/FoldVertexControls';
import styles from './FoldToolWindow.module.css';

/**
 * A choice of a few named ways, under a heading of its own so their names
 * fit across the window: a precrease's extent (`data-fold-extent`), a petal
 * fold's hinge or a swivel's target (`data-fold-line-by`).
 */
function ChoiceSegments<K extends string>({
  choice,
  section,
}: {
  choice: FoldKindChoice<K>;
  section: 'extent' | 'lineBy' | 'swivelInput' | 'squashHinge';
}) {
  return (
    <div
      className={styles.section}
      data-fold-extent={section === 'extent' ? '' : undefined}
      data-fold-line-by={section === 'lineBy' ? '' : undefined}
      data-fold-swivel-input={section === 'swivelInput' ? '' : undefined}
      data-fold-squash-hinge={section === 'squashHinge' ? '' : undefined}
    >
      <span className={styles.heading}>{choice.label}</span>
      <SegmentedControl<K>
        size="sm"
        fill
        aria-label={choice.label}
        value={choice.value}
        disabled={choice.disabled}
        options={choice.options.map((option) => ({
          value: option.value,
          label: option.short,
          tooltip: option.label,
          disabled: option.disabled,
        }))}
        onChange={choice.set}
      />
      {choice.note && <p className={styles.note}>{choice.note}</p>}
    </div>
  );
}

/**
 * The Fold canvas's tool window: the app's window chrome (`ToolHintWindow`)
 * with what the tool in hand has to say inside it — how to locate the line and
 * the line mode while it is being located; then the fold's kind, the moving
 * side, the layers at the line, a refusal with its fixes, and Cancel / commit.
 *
 * One renderer for every Fold tool. What a tool shows is its model, built in
 * `fold/tools/foldToolWindow.ts`; nothing here knows which tool it draws.
 * Enter and Escape reach the commit and the cancel through the workspace's
 * keys, not these buttons; the buttons name those keys in their titles.
 *
 * Mounted outside any element with a context-menu handler: the window is
 * portaled, and portal events still bubble through React (`ToolHintWindow`).
 *
 * On a phone it starts collapsed to its title bar, so the paper stays in view
 * while points are picked, and opens by itself while a fold waits to be
 * decided and committed; a tap on the bar opens or closes it.
 */
export function FoldToolWindow({
  container,
  model,
  keyLabel,
  onFrame,
  resolution,
  acceptOrder,
  orderReady = false,
  inspection,
  tool,
}: {
  /**
   * The tool in hand: with the step the window is at (`model.phase`), what it
   * shows from its top when either changes, its first instruction in view.
   */
  tool?: string;
  /** The viewport cell the window anchors to. */
  resolution?: FoldOrderResolution | null;
  acceptOrder?: () => void;
  orderReady?: boolean;
  inspection?: FoldOrderInspection;
  container: HTMLElement | null;
  model: FoldToolWindowModel | null;
  /** The label of a Fold key; without it the buttons name none. */
  keyLabel?: FoldKeyLabel;
  /** The window's frame, as it mounts and goes: what a phone's pane fits its paper above (`useFoldWindowInset`). */
  onFrame?: (frame: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhoneLayout();
  if (!model) return null;
  if (resolution?.active) return (
    <ToolHintWindow container={container} collapseKey={STORAGE_KEYS.foldToolHintCollapsed}
      title={t('tools:fold.order.choose', 'Choose layer order')} meta=""
      ariaLabel={t('tools:fold.order.choose', 'Choose layer order')} collapsible={false} height={phone ? 'capped' : 'default'} onFrame={onFrame}
      {...(tool !== undefined ? { startKey: `${tool}:order` } : {})}>
      <FoldOrderChooser index={resolution.index} count={resolution.count} exact={resolution.exact}
        error={resolution.failed} movingVaries={resolution.movingVaries}
        ready={orderReady && !resolution.waiting && !resolution.failed} waiting={resolution.waiting}
        searching={resolution.searching} searched={resolution.searched}
        onStep={resolution.step} onBack={resolution.back} onAccept={acceptOrder ?? (() => {})}
        onSearch={!resolution.exact && resolution.canSearch ? resolution.search : undefined}
        onStop={resolution.searching ? resolution.stop : undefined} />
      {inspection && <FoldOrderStacks inspection={inspection} />}
    </ToolHintWindow>
  );
  const titled = (label: string, shortcut: FoldShortcutId) => {
    const key = keyLabel?.(shortcut);
    return key ? `${label} (${key})` : label;
  };
  // The tool's own key beside its name, so a key that took another tool is seen at once. Not on a phone: no keys.
  const toolShortcut = tool !== undefined && tool in FOLD_TOOL_SHORTCUTS ? FOLD_TOOL_SHORTCUTS[tool as FoldToolId] : undefined;
  const toolKey = !phone && toolShortcut ? keyLabel?.(toolShortcut) : undefined;
  const windowTitle = toolKey ? `${model.title} · ${toolKey}` : model.title;
  const {
    instructions,
    lineMode,
    freeLineSnap,
    secondLine,
    kind,
    extent,
    movingSide,
    layers,
    refusal,
    divide,
    compound,
    tuck,
    vertex,
    sink,
    rotate,
    steps,
    repeat,
    footer,
  } = model;

  return (
    <ToolHintWindow
      container={container}
      collapseKey={STORAGE_KEYS.foldToolHintCollapsed}
      title={windowTitle}
      meta={model.meta}
      ariaLabel={t('tools:fold.window.label', 'Fold tool options')}
      // A phone's pane is the paper the tool picks points on: the open window
      // would cover it, so it starts as its title bar, and opens by itself
      // once there is a fold to decide and commit.
      startsCollapsed={phone}
      needsAttention={phone && model.phase === 'preview'}
      // Open, it keeps to a third of a phone's height, so the fold it
      // previews stays in view above it.
      height={phone ? 'capped' : 'default'}
      onFrame={onFrame}
      {...(tool !== undefined ? { startKey: `${tool}:${model.phase}` } : {})}
    >
      <div className={styles.section}>
        <ToolHintInstructions
          heading={instructions.heading}
          intro={instructions.intro}
          items={instructions.items}
          ordered
          current={instructions.current}
        />
        {instructions.notes.map((note) => (
          <p key={note} className={styles.note}>
            {note}
          </p>
        ))}
      </div>
      {/* The sequence tools: the step Unfold to step returns to, or the range Repeat starts with, then Repeat's axis. */}
      {(steps || repeat) && (
        <div className={styles.section} data-fold-sequence="">
          {steps && (
            <SelectRow
              label={steps.label}
              value={steps.value}
              options={steps.options}
              disabled={steps.disabled}
              divider={false}
              onChange={steps.set}
            />
          )}
          {repeat && (
            <SelectRow
              label={repeat.axis.label}
              value={repeat.axis.value}
              placeholder={repeat.axis.placeholder}
              options={repeat.axis.options}
              disabled={repeat.axis.disabled}
              divider={false}
              onChange={repeat.axis.set}
            />
          )}
        </div>
      )}
      {/* A petal fold's hinge, or a swivel's target: how it is named, which its steps above follow. */}
      {vertex?.input && <ChoiceSegments choice={vertex.input} section="swivelInput" />}
      {vertex?.hinge && <ChoiceSegments choice={vertex.hinge} section="squashHinge" />}
      {vertex?.lineBy && <ChoiceSegments choice={vertex.lineBy} section="lineBy" />}
      {/* No dividers: the window divides its own sections. */}
      {divide && (
        <div className={styles.section} data-fold-divide="">
          <SegmentedRow
            label={divide.mode.label}
            value={divide.mode.value}
            options={divide.mode.options}
            disabled={divide.disabled}
            onChange={(mode) => divide.mode.set(mode === 'ratio' ? 'ratio' : 'count')}
          />
          {divide.parts && (
            <NumberRow
              label={divide.parts.label}
              value={divide.parts.value}
              min={divide.parts.min}
              max={divide.parts.max}
              step={1}
              disabled={divide.disabled}
              onCommit={divide.parts.set}
            />
          )}
          {divide.ratio && (
            <>
              <TextRow
                label={divide.ratio.left.label}
                value={divide.ratio.left.value}
                disabled={divide.disabled}
                onCommit={divide.ratio.left.set}
              />
              <TextRow
                label={divide.ratio.right.label}
                value={divide.ratio.right.value}
                disabled={divide.disabled}
                onCommit={divide.ratio.right.set}
              />
              <p className={styles.note}>{divide.ratio.readout}</p>
            </>
          )}
          <Button size="sm" variant="secondary" disabled={divide.clear.disabled} onClick={divide.clear.run}>
            {divide.clear.label}
          </Button>
        </div>
      )}
      {lineMode && (
        <div className={styles.section}>
          <SelectRow
            label={lineMode.label}
            value={lineMode.value}
            options={lineMode.options}
            disabled={lineMode.disabled}
            divider={false}
            onChange={lineMode.set}
          />
          {/* A crimp's second line, located after the first: a select as the first's is, the names too long for a segment. */}
          {secondLine && (
            <SelectRow
              label={secondLine.label}
              value={secondLine.value}
              options={secondLine.options}
              disabled={secondLine.disabled}
              divider={false}
              onChange={secondLine.set}
            />
          )}
        </div>
      )}
      {freeLineSnap && (
        <div className={styles.section}>
          <ToggleRow label={freeLineSnap.label} help={freeLineSnap.help} checked={freeLineSnap.checked}
            disabled={freeLineSnap.disabled} divider={false} onChange={freeLineSnap.set} />
        </div>
      )}
      {/* How Repeat is saved, and how many operations it repeats. */}
      {repeat && (repeat.individual || repeat.summary) && (
        <div className={styles.section} data-fold-repeat-saving="">
          {repeat.individual && (
            <ToggleRow
              label={repeat.individual.label}
              checked={repeat.individual.checked}
              disabled={repeat.individual.disabled}
              divider={false}
              onChange={repeat.individual.set}
            />
          )}
          {repeat.summary && <p className={styles.note}>{repeat.summary}</p>}
        </div>
      )}
      {/* A source operation's matching layer orders: the chooser every fold's orders are chosen with. */}
      {repeat?.order && (
        <div className={styles.section} data-fold-repeat-order="">
          <FoldOrderChooser
            index={repeat.order.index}
            count={repeat.order.count}
            exact
            ready={repeat.order.ready}
            waiting={repeat.order.waiting}
            error={repeat.order.failed}
            onStep={repeat.order.step}
            onBack={repeat.order.back}
            onAccept={repeat.order.accept}
          />
        </div>
      )}
      {kind && (
        <div className={styles.section}>
          <FieldRow label={kind.label} kind="segmented" divider={false} disabled={kind.disabled}>
            <SegmentedControl<FoldKind>
              size="sm"
              iconsOnly
              aria-label={kind.label}
              value={kind.value}
              disabled={kind.disabled}
              options={kind.options.map((option) => ({
                value: option.value,
                label: option.label,
                icon: <FoldKindMark kind={option.value} />,
                // A letter names nothing to someone who has not met it.
                tooltip: option.label,
              }))}
              onChange={kind.set}
            />
          </FieldRow>
        </div>
      )}
      {/* A precrease's extent: the whole line, a segment or a pinch, under a heading of its own so the three names fit. */}
      {extent && <ChoiceSegments<FoldExtentMode> choice={extent} section="extent" />}
      {/* Rotate's amount — a part of a turn, or an exact angle — then which way the model turns. */}
      {rotate && (
        <div className={styles.section} data-fold-rotate="">
          <span className={styles.heading}>{rotate.amount.label}</span>
          <SegmentedControl<TurnRotationPreset>
            size="sm"
            fill
            aria-label={rotate.amount.label}
            value={rotate.amount.value}
            disabled={rotate.disabled}
            options={rotate.amount.options.map((option) => ({
              value: option.value,
              label: option.label,
              tooltip: option.tooltip,
            }))}
            onChange={rotate.amount.set}
          />
          <NumberRow
            label={rotate.degrees.label}
            value={rotate.degrees.value}
            step={rotate.degrees.step}
            suffix={rotate.degrees.suffix}
            disabled={rotate.disabled}
            // A number that names no turn leaves the field as it was.
            normalize={(typed) => (rotate.degrees.accepts(typed) ? typed : rotate.degrees.value)}
            onCommit={rotate.degrees.set}
          />
        </div>
      )}
      {rotate && (
        <div className={styles.section} data-fold-rotate-direction="">
          <span className={styles.heading}>{rotate.direction.label}</span>
          <SegmentedControl<TurnDirection>
            size="sm"
            fill
            aria-label={rotate.direction.label}
            value={rotate.direction.value}
            disabled={rotate.disabled}
            options={rotate.direction.options.map((option) => ({
              value: option.value,
              label: option.label,
              icon:
                option.value === 'cw' ? (
                  <RotateCw size={13} aria-hidden="true" />
                ) : (
                  <RotateCcw size={13} aria-hidden="true" />
                ),
            }))}
            onChange={rotate.direction.set}
          />
        </div>
      )}
      {/* A reverse fold's or a crimp's kind, only while both fit: the title names the one folded. */}
      {model.reversePreference && (
        <div className={styles.section}>
          <SelectRow
            label={model.reversePreference.label}
            value={model.reversePreference.value}
            options={model.reversePreference.options.map((option) => ({ id: option.value, label: option.short }))}
            disabled={model.reversePreference.disabled}
            divider={false}
            onChange={(value) => {
              if (value === 'auto' || value === 'inside' || value === 'outside') model.reversePreference?.set(value);
            }}
          />
          {model.reversePreference.note && <p className={styles.note}>{model.reversePreference.note}</p>}
        </div>
      )}
      {compound?.kind && (
        <div className={styles.section} data-fold-reverse-kind="">
          <FoldReverseKindControl kind={compound.kind} />
        </div>
      )}
      {vertex && (vertex.kind || vertex.direction || vertex.note) && (
        <div className={styles.section} data-fold-vertex="">
          <FoldVertexDirection controls={vertex} />
        </div>
      )}
      {vertex && hasVertexChoices(vertex) && (
        <div className={styles.section} data-fold-choices="">
          <FoldVertexChoices controls={vertex} />
        </div>
      )}
      {sink && (sink.kind || sink.depth) && (
        <div className={styles.section} data-fold-sink-kind="">
          <FoldSinkLine controls={resolution ? { ...sink, order: null } : sink} />
        </div>
      )}
      {movingSide && (
        <div className={styles.section}>
          <FieldRow label={movingSide.label} kind="static" divider={false} disabled={movingSide.disabled}>
            <Button
              size="sm"
              variant="secondary"
              title={titled(movingSide.swapLabel, movingSide.shortcut)}
              disabled={movingSide.disabled}
              onClick={movingSide.swap}
            >
              <ArrowLeftRight size={13} aria-hidden="true" />
              {movingSide.swapLabel}
            </Button>
          </FieldRow>
        </div>
      )}
      {layers && (
        <div className={styles.section} data-fold-layers="">
          <div className={styles.layersHeader}>
            <span className={styles.heading}>{layers.title}</span>
            {layers.summary && <span className={styles.summary}>{layers.summary}</span>}
          </div>
          {layers.picker ? (
            <FoldCrossSectionPicker
              model={layers.picker}
              disabled={layers.disabled}
              onToggle={layers.toggle}
              onHover={layers.hover}
            />
          ) : (
            <p className={styles.note} role="status">
              {layers.finding}
            </p>
          )}
          {layers.picker && <p className={styles.note}>{layers.help}</p>}
          <FoldFlapChips
            chips={layers.chips}
            disabled={layers.disabled}
            onToggle={layers.toggle}
            onHover={layers.hover}
          />
        </div>
      )}
      {compound && (compound.opening || (!resolution && compound.order)) && (
        <div className={styles.section} data-fold-choices="">
          <FoldReverseChoices controls={resolution ? { ...compound, order: null } : compound} />
        </div>
      )}
      {/* A tuck's layers to tuck against, which the folded paper lights, and its order. */}
      {tuck && (tuck.note || tuck.target || (!resolution && tuck.order)) && (
        <div className={styles.section} data-fold-tuck="">
          {tuck.note && <p className={styles.note}>{tuck.note}</p>}
          {tuck.target && <FoldChoiceStepperRow stepper={tuck.target} />}
          {tuck.additional?.map((item) => (
            <ToggleRow key={item.label} label={item.label} checked={item.checked} disabled={item.disabled} onChange={item.toggle} />
          ))}
          {!resolution && tuck.order && <FoldChoiceStepperRow stepper={tuck.order} />}
        </div>
      )}
      {sink && (sink.pocket || (!resolution && sink.order)) && (
        <div className={styles.section} data-fold-choices="">
          <FoldSinkChoices controls={resolution ? { ...sink, order: null } : sink} />
        </div>
      )}
      {/* Docked to the window's bottom edge, the body scrolling under it: the
          refusal is read whole, and the fold is a press away, however much
          the window holds above them. */}
      {(refusal || footer) && (
        <FloatingPanelDock data-fold-window-dock="">
          {/* The last seed's refusal keeps its place, dimmed, until this one's answer is in. */}
          {refusal && (
            <div className={styles.section} data-held={model.held ? '' : undefined}>
              <FoldRefusalNotice notice={refusal} />
            </div>
          )}
          {footer && (
            <div className={styles.section} data-footer="">
              <div className={styles.footer}>
                <Button
                  size="sm"
                  variant="secondary"
                  title={titled(footer.cancel.label, footer.cancel.shortcut)}
                  disabled={footer.cancel.disabled}
                  onClick={footer.cancel.run}
                >
                  {footer.cancel.label}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  title={titled(footer.commit.label, footer.commit.shortcut)}
                  disabled={footer.commit.disabled}
                  onClick={footer.commit.run}
                >
                  {footer.commit.label}
                </Button>
              </div>
            </div>
          )}
        </FloatingPanelDock>
      )}
    </ToolHintWindow>
  );
}
