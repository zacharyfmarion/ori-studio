import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  OristudioCpCustomLineType,
  OristudioCpLineColor,
  OristudioCpRgbColor,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpActionDefinition } from '../../lib/oristudioCpActions';
import type { OristudioCpCommandDefinition } from '../../lib/oristudioCpCommands';
import {
  ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS,
  ORISTUDIO_CP_RATIO_PRESETS,
  ORISTUDIO_CP_REPLACE_TARGET_LINE_TYPE_OPTIONS,
  cpToolSettingGroupsForCommand,
  evaluateOrieditaRatioExpression,
  formatOrieditaRatioHalf,
  formatOrieditaRatioNumber,
  parseOrieditaRatioHalfInput,
  ratioExpressionFromHalves,
  ratioHalvesFromExpression,
  type OristudioCpRatioExpression,
  type OristudioCpToolOptions,
  type OristudioCpToolSettingGroup,
} from '../../lib/oristudioCpToolSettings';
import {
  instructionsForCpTool,
  type OristudioCpToolInstructions,
} from '../../lib/oristudioCpToolInstructions';
import { cpPaletteEntryForColor } from '../../lib/oristudioCpPalette';
import { cpLineAssignmentLabel, type OristudioCpSelection } from '../../lib/creasePatternViewport';
import { isSelectionCircleApplyOperation } from '../../cp-workspace/tools/predicates';
import {
  CP_MEASUREMENT_SLOT_LABELS,
  CP_MEASUREMENT_SLOT_ORDER,
  cpMeasurementSlotForOperation,
  formatCpMeasurementValue,
  type CpMeasurementSlotId,
  type CpMeasurementSlots,
} from '../../cp-workspace/measure';

export function cpLineTypeStatusLabel(lineColor: OristudioCpLineColor): string {
  return cpPaletteEntryForColor(lineColor)?.statusLabel ?? `Line ${cpLineAssignmentLabel(lineColor)}`;
}

export function cpCommandRequiresContextApply(command: OristudioCpCommandDefinition): boolean {
  if (command.operationId === 'Text') return true;
  if (command.operationId === 'VoronoiCreate') return true;
  if (isSelectionCircleApplyOperation(command.operationId)) return true;
  if ((command.toolSteps?.length ?? 0) > 0) return false;
  return cpToolSettingGroupsForCommand(command).some(
    (group) => group !== 'line-color' && group !== 'line-select-help'
  );
}

function contextApplyDisabledForCommand(
  command: OristudioCpCommandDefinition,
  selection: OristudioCpSelection,
  pendingPointCount: number
): boolean {
  switch (command.operationId) {
    case 'VoronoiCreate':
      return pendingPointCount === 0;
    case 'Text':
      return selection.texts.length === 0;
    case 'CircleChangeColor':
      return selection.circles.length === 0 && selection.lines.length === 0;
    case 'CircleDrawTangentLine':
      return selection.circles.length < 2;
    case 'CircleDrawInverted':
      return selection.circles.length < 2 && !(selection.circles.length >= 1 && selection.lines.length >= 1);
    case 'CircleDrawConcentricSelect':
      return selection.circles.length < 3;
    case 'CircleDrawConcentricTwoCircleSelect':
      return selection.circles.length < 2;
    default:
      return false;
  }
}

export function CpContextToolPanel({
  action,
  command,
  options,
  setOptions,
  activeLineColor,
  measurementSlots,
  pendingPointCount,
  selection,
  onApply,
  onClearInput,
  onDeleteText,
}: {
  action: OristudioCpActionDefinition | undefined;
  command: OristudioCpCommandDefinition;
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  activeLineColor: OristudioCpLineColor;
  measurementSlots: CpMeasurementSlots;
  pendingPointCount: number;
  selection: OristudioCpSelection;
  onApply?: () => void;
  onClearInput?: () => void;
  onDeleteText?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const groups = cpToolSettingGroupsForCommand(command);
  const instructions = instructionsForCpTool(action, command);
  const applyDisabled = contextApplyDisabledForCommand(command, selection, pendingPointCount);
  const title = action?.kind === 'command' ? action.label : command.label;
  const meta =
    groups.length > 0
      ? `${groups.length} ${groups.length === 1 ? 'setting' : 'settings'}`
      : 'Instructions';

  if (groups.length === 0 && !instructions) return null;

  return (
    <section
      className="cp-context-panel"
      aria-label="Crease pattern tool options"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="cp-context-panel__header"
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className="cp-context-panel__title">{title}</span>
        <span className="cp-context-panel__meta">{meta}</span>
      </button>
      {!collapsed && (
        <div className="cp-context-panel__body">
          {instructions && <CpContextToolInstructions instructions={instructions} />}
          {groups.map((group) => (
            <CpContextToolGroup
              key={group}
              group={group}
              options={options}
              setOptions={setOptions}
              activeLineColor={activeLineColor}
              activeMeasurementSlot={cpMeasurementSlotForOperation(command.operationId)}
              activeOperationId={command.operationId}
              measurementSlots={measurementSlots}
              pendingPointCount={pendingPointCount}
              selection={selection}
            />
          ))}
          {onApply && (
            <button
              className="cp-context-panel__apply"
              type="button"
              disabled={applyDisabled}
              onClick={onApply}
            >
              {command.operationId === 'VoronoiCreate'
                ? 'Apply Voronoi'
                : command.operationId === 'Text'
                  ? 'Apply text'
                  : command.operationId === 'CircleChangeColor'
                    ? 'Apply color'
                    : isSelectionCircleApplyOperation(command.operationId)
                      ? 'Apply circle'
                  : 'Apply to selection'}
            </button>
          )}
          {onDeleteText && (
            <button className="cp-context-panel__secondary" type="button" onClick={onDeleteText}>
              Delete text
            </button>
          )}
          {onClearInput && (
            <button className="cp-context-panel__secondary" type="button" onClick={onClearInput}>
              Clear seeds
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function CpContextToolInstructions({
  instructions,
}: {
  instructions: OristudioCpToolInstructions;
}) {
  const hasIntro = (instructions.intro?.length ?? 0) > 0;
  const hasSteps = (instructions.steps?.length ?? 0) > 0;
  const hasNotes = (instructions.notes?.length ?? 0) > 0;

  return (
    <div className="cp-context-panel__instructions">
      <div className="cp-context-panel__group-title">Instructions</div>
      {hasIntro && (
        <div className="cp-context-panel__instruction-copy">
          {instructions.intro?.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
      {hasSteps && (
        <ol className="cp-context-panel__instruction-list">
          {instructions.steps?.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      {hasNotes && (
        <div className="cp-context-panel__instruction-notes">
          {instructions.notes?.map((note) => <p key={note}>{note}</p>)}
        </div>
      )}
    </div>
  );
}

function CpContextToolGroup({
  group,
  options,
  setOptions,
  activeLineColor,
  activeMeasurementSlot,
  activeOperationId,
  measurementSlots,
  pendingPointCount,
  selection,
}: {
  group: OristudioCpToolSettingGroup;
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  activeLineColor: OristudioCpLineColor;
  activeMeasurementSlot: CpMeasurementSlotId | null;
  activeOperationId: OristudioCpCommandDefinition['operationId'];
  measurementSlots: CpMeasurementSlots;
  pendingPointCount: number;
  selection: OristudioCpSelection;
}) {
  if (group === 'line-color') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Line type</div>
        <div className="cp-context-panel__readout">{cpLineTypeStatusLabel(activeLineColor)}</div>
      </div>
    );
  }

  if (group === 'division-count') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Divide by count</div>
        <NumericToolOption
          label="Count"
          ariaLabel="Division count"
          min={1}
          max={256}
          step={1}
          value={options.divisionCount}
          onChange={(divisionCount) =>
            setOptions((current) => ({ ...current, divisionCount }))
          }
        />
      </div>
    );
  }

  if (group === 'division-ratio') {
    return <DivisionRatioOptions options={options} setOptions={setOptions} />;
  }

  if (group === 'angle-system') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Angle system</div>
        <NumericToolOption
          label="Divider"
          ariaLabel="Angle system divider"
          min={0}
          max={360}
          step={1}
          value={options.angleSystemDivider}
          onChange={(angleSystemDivider) =>
            setOptions((current) => ({ ...current, angleSystemDivider }))
          }
        />
        <div className="cp-context-panel__angle-grid">
          {ANGLE_FIELDS.map((field, index) => (
            <NumericToolOption
              key={field}
              label={field}
              ariaLabel={`Angle ${field}`}
              min={0}
              max={360}
              step={0.1}
              value={options.angleSystemAngles[index] ?? 0}
              onChange={(value) => updateAngleField(setOptions, index, value)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (group === 'replace-line-type') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Replace line type</div>
        <SelectToolOption
          label="From"
          ariaLabel="Replace from line type"
          value={options.customFromLineType}
          options={ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS}
          onChange={(customFromLineType) =>
            setOptions((current) => ({ ...current, customFromLineType }))
          }
        />
        <SelectToolOption
          label="To"
          ariaLabel="Replace to line type"
          value={options.customToLineType}
          options={ORISTUDIO_CP_REPLACE_TARGET_LINE_TYPE_OPTIONS}
          onChange={(customToLineType) =>
            setOptions((current) => ({ ...current, customToLineType }))
          }
        />
      </div>
    );
  }

  if (group === 'delete-line-type') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Delete line type</div>
        <SelectToolOption
          label="Filter"
          ariaLabel="Delete line type"
          value={options.customLineType}
          options={ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS}
          onChange={(customLineType) =>
            setOptions((current) => ({ ...current, customLineType }))
          }
        />
      </div>
    );
  }

  if (group === 'erase-line-type') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Erase</div>
        <SelectToolOption
          label="Filter"
          ariaLabel="Erase line type"
          value={options.customLineType}
          options={ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS}
          onChange={(customLineType) =>
            setOptions((current) => ({ ...current, customLineType }))
          }
        />
      </div>
    );
  }

  if (group === 'fix-precision') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Fix inaccurate</div>
        <NumericToolOption
          label="Precision"
          ariaLabel="Fix precision"
          min={0}
          max={100}
          step={0.01}
          value={options.fixPrecision}
          onChange={(fixPrecision) => setOptions((current) => ({ ...current, fixPrecision }))}
        />
        <CheckboxToolOption
          label="BP"
          ariaLabel="Use BP fix targets"
          checked={options.fixPrecisionUseBp}
          onChange={(fixPrecisionUseBp) =>
            setOptions((current) => ({ ...current, fixPrecisionUseBp }))
          }
        />
        <CheckboxToolOption
          label="22.5"
          ariaLabel="Use 22.5 fix targets"
          checked={options.fixPrecisionUse22_5}
          onChange={(fixPrecisionUse22_5) =>
            setOptions((current) => ({ ...current, fixPrecisionUse22_5 }))
          }
        />
      </div>
    );
  }

  if (group === 'polygon-corners') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Regular polygon</div>
        <NumericToolOption
          label="Corners"
          ariaLabel="Polygon corners"
          min={3}
          max={256}
          step={1}
          value={options.polygonCorners}
          onChange={(polygonCorners) =>
            setOptions((current) => ({ ...current, polygonCorners }))
          }
        />
      </div>
    );
  }

  if (group === 'parallel-width') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Parallel width</div>
        <NumericToolOption
          label="Width"
          ariaLabel="Parallel width"
          min={0}
          max={9999}
          step={0.1}
          value={options.parallelWidth}
          onChange={(parallelWidth) =>
            setOptions((current) => ({ ...current, parallelWidth }))
          }
        />
      </div>
    );
  }

  if (group === 'candidate-choice') {
    const usesNearestCandidate =
      activeOperationId !== 'CircleDrawTangentLine' &&
      activeOperationId !== 'CircleDrawConcentricSelect';
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Candidate</div>
        <CheckboxToolOption
          label={usesNearestCandidate ? 'Auto nearest' : 'First candidate'}
          ariaLabel={usesNearestCandidate ? 'Use nearest candidate' : 'Use first candidate'}
          checked={options.candidateIndex === null}
          onChange={(useNearest) =>
            setOptions((current) => ({
              ...current,
              candidateIndex: useNearest ? null : 0,
            }))
          }
        />
        <NumericToolOption
          label="Index"
          ariaLabel="Candidate index"
          min={1}
          max={256}
          step={1}
          value={(options.candidateIndex ?? 0) + 1}
          disabled={options.candidateIndex === null}
          onChange={(candidateIndex) =>
            setOptions((current) => ({
              ...current,
              candidateIndex: Math.max(0, candidateIndex - 1),
            }))
          }
        />
      </div>
    );
  }

  if (group === 'circle-select-help') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Circle selection</div>
        <div className="cp-context-panel__readout">
          {selection.circles.length} circle{selection.circles.length === 1 ? '' : 's'} selected
          {selection.lines.length > 0
            ? `, ${selection.lines.length} crease${selection.lines.length === 1 ? '' : 's'} selected`
            : ''}
        </div>
      </div>
    );
  }

  if (group === 'apply-lines') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">
          {activeOperationId === 'VoronoiCreate' ? 'Voronoi seeds' : 'Apply lines'}
        </div>
        <div className="cp-context-panel__readout">
          {activeOperationId === 'VoronoiCreate'
            ? `${pendingPointCount} seed ${pendingPointCount === 1 ? 'press' : 'presses'} pending`
            : 'Apply the generated lines from this tool.'}
        </div>
      </div>
    );
  }

  if (group === 'measurement-readout') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Measurement</div>
        <div className="cp-context-panel__measurement-grid">
          {CP_MEASUREMENT_SLOT_ORDER.map((slot) => (
            <div
              key={slot}
              className="cp-context-panel__measurement-row"
              data-active={slot === activeMeasurementSlot || undefined}
              data-measurement-slot={slot}
            >
              <span>{CP_MEASUREMENT_SLOT_LABELS[slot]}</span>
              <span>{formatCpMeasurementValue(slot, measurementSlots[slot])}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (group === 'custom-circle-color') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Circle color</div>
        <div
          className="cp-context-panel__color-swatch"
          style={{
            backgroundColor: `rgb(${options.customCircleColor.red}, ${options.customCircleColor.green}, ${options.customCircleColor.blue})`,
          }}
          aria-hidden="true"
        />
        <div className="cp-context-panel__angle-grid">
          {RGB_FIELDS.map((field) => (
            <NumericToolOption
              key={field.key}
              label={field.label}
              ariaLabel={field.ariaLabel}
              min={0}
              max={255}
              step={1}
              value={options.customCircleColor[field.key]}
              onChange={(value) => updateCustomCircleColor(setOptions, field.key, value)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (group === 'text-content') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Text annotation</div>
        <TextAreaToolOption
          label="Text"
          ariaLabel="Text annotation content"
          value={options.textContent}
          onChange={(textContent) => setOptions((current) => ({ ...current, textContent }))}
        />
        <div className="cp-context-panel__readout">
          {selection.texts.length === 0 ? 'No text selected' : `${selection.texts.length} selected`}
        </div>
      </div>
    );
  }

  if (group === 'line-select-help') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">Line selection</div>
        <div className="cp-context-panel__readout">Drag across creases to apply this action.</div>
      </div>
    );
  }

  return null;
}

const RATIO_FIELDS: readonly {
  key: keyof OristudioCpRatioExpression;
  label: string;
  ariaLabel: string;
  min?: number;
  step: number;
}[] = [
  { key: 'a', label: 'A', ariaLabel: 'Ratio A', step: 0.1 },
  { key: 'b', label: 'B', ariaLabel: 'Ratio B', step: 0.1 },
  { key: 'c', label: 'C', ariaLabel: 'Ratio C', min: 0, step: 0.1 },
  { key: 'd', label: 'D', ariaLabel: 'Ratio D', step: 0.1 },
  { key: 'e', label: 'E', ariaLabel: 'Ratio E', step: 0.1 },
  { key: 'f', label: 'F', ariaLabel: 'Ratio F', min: 0, step: 0.1 },
];

function DivisionRatioOptions({
  options,
  setOptions,
}: {
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
}) {
  const initialHalves = ratioHalvesFromExpression(options.divisionRatio);
  const [leftDraft, setLeftDraft] = useState(() => formatOrieditaRatioHalf(initialHalves.left));
  const [rightDraft, setRightDraft] = useState(() => formatOrieditaRatioHalf(initialHalves.right));
  const ratio = evaluateOrieditaRatioExpression(options.divisionRatio);
  const leftInvalid = parseOrieditaRatioHalfInput(leftDraft) === null;
  const rightInvalid = parseOrieditaRatioHalfInput(rightDraft) === null;

  const applyRatioExpression = useCallback(
    (divisionRatio: OristudioCpRatioExpression) => {
      const halves = ratioHalvesFromExpression(divisionRatio);
      setLeftDraft(formatOrieditaRatioHalf(halves.left));
      setRightDraft(formatOrieditaRatioHalf(halves.right));
      setOptions((current) => ({ ...current, divisionRatio }));
    },
    [setOptions]
  );

  const updateSimpleHalf = useCallback(
    (side: 'left' | 'right', value: string) => {
      if (side === 'left') {
        setLeftDraft(value);
      } else {
        setRightDraft(value);
      }
      const parsed = parseOrieditaRatioHalfInput(value);
      if (!parsed) return;
      setOptions((current) => {
        const halves = ratioHalvesFromExpression(current.divisionRatio);
        return {
          ...current,
          divisionRatio: ratioExpressionFromHalves(
            side === 'left' ? parsed : halves.left,
            side === 'right' ? parsed : halves.right
          ),
        };
      });
    },
    [setOptions]
  );

  const updateExactField = useCallback(
    (field: keyof OristudioCpRatioExpression, value: number) => {
      const divisionRatio = {
        ...options.divisionRatio,
        [field]: value,
      };
      applyRatioExpression(divisionRatio);
    },
    [applyRatioExpression, options.divisionRatio]
  );

  return (
    <div className="cp-context-panel__group">
      <div className="cp-context-panel__group-title">Divide by ratio</div>
      <div className="cp-context-panel__ratio-simple">
        <TextToolOption
          label="Left"
          ariaLabel="Left segment ratio"
          value={leftDraft}
          invalid={leftInvalid}
          onChange={(value) => updateSimpleHalf('left', value)}
        />
        <TextToolOption
          label="Right"
          ariaLabel="Right segment ratio"
          value={rightDraft}
          invalid={rightInvalid}
          onChange={(value) => updateSimpleHalf('right', value)}
        />
      </div>
      <div className="cp-context-panel__preset-grid" aria-label="Ratio presets">
        {ORISTUDIO_CP_RATIO_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="cp-context-panel__preset"
            data-active={sameRatioExpression(options.divisionRatio, preset.expression) || undefined}
            aria-label={`Use ${preset.label} ratio`}
            onClick={() => applyRatioExpression(preset.expression)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="cp-context-panel__readout">
        Computed ratio {formatOrieditaRatioNumber(ratio.ratioS)} :{' '}
        {formatOrieditaRatioNumber(ratio.ratioT)}
      </div>
      <details className="cp-context-panel__details">
        <summary>Exact form</summary>
        <div className="cp-context-panel__ratio-grid">
          {RATIO_FIELDS.map((field) => (
            <NumericToolOption
              key={field.key}
              label={field.label}
              ariaLabel={field.ariaLabel}
              min={field.min}
              max={999}
              step={field.step}
              value={options.divisionRatio[field.key]}
              onChange={(value) => updateExactField(field.key, value)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function sameRatioExpression(
  left: OristudioCpRatioExpression,
  right: OristudioCpRatioExpression
): boolean {
  return RATIO_FIELDS.every((field) => left[field.key] === right[field.key]);
}

const ANGLE_FIELDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

const RGB_FIELDS: readonly {
  key: keyof OristudioCpRgbColor;
  label: string;
  ariaLabel: string;
}[] = [
  { key: 'red', label: 'R', ariaLabel: 'Circle color red' },
  { key: 'green', label: 'G', ariaLabel: 'Circle color green' },
  { key: 'blue', label: 'B', ariaLabel: 'Circle color blue' },
];

function updateAngleField(
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>,
  index: number,
  value: number
) {
  setOptions((current) => {
    const angleSystemAngles = [...current.angleSystemAngles] as OristudioCpToolOptions['angleSystemAngles'];
    angleSystemAngles[index] = value;
    return {
      ...current,
      angleSystemAngles,
    };
  });
}

function updateCustomCircleColor(
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>,
  field: keyof OristudioCpRgbColor,
  value: number
) {
  setOptions((current) => ({
    ...current,
    customCircleColor: {
      ...current.customCircleColor,
      [field]: Math.round(value),
    },
  }));
}

function NumericToolOption({
  label,
  ariaLabel,
  min,
  max,
  step,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  min?: number;
  max?: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  // Edit against a local string draft so the field can be cleared or hold a partial
  // value while typing; only parse/clamp/commit on blur or Enter. A controlled
  // number input that committed every keystroke snapped an emptied field back to its
  // old value (and committed intermediate digits, e.g. backspacing "16" → "1").
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => String(value));
  // Re-sync the draft when the committed value changes from outside — but never
  // while the user is mid-edit in this field.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (Number.isFinite(parsed)) {
      const clamped = clampToolNumber(parsed, min, max);
      onChange(clamped);
      setDraft(String(clamped));
    } else {
      // Empty or unparseable: revert to the last committed value.
      setDraft(String(value));
    }
  };

  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function TextToolOption({
  label,
  ariaLabel,
  value,
  invalid,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        type="text"
        value={value}
        aria-invalid={invalid}
        data-invalid={invalid || undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function TextAreaToolOption({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="cp-context-panel__field cp-context-panel__field--textarea">
      <span>{label}</span>
      <textarea
        aria-label={ariaLabel}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function SelectToolOption({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: OristudioCpCustomLineType;
  options: readonly { value: OristudioCpCustomLineType; label: string }[];
  onChange: (value: OristudioCpCustomLineType) => void;
}) {
  return (
    <label className="cp-context-panel__field">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as OristudioCpCustomLineType)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxToolOption({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="cp-context-panel__checkbox">
      <input
        aria-label={ariaLabel}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function clampToolNumber(value: number, min: number | undefined, max: number | undefined): number {
  const lowerBounded = min === undefined ? value : Math.max(min, value);
  return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
}
