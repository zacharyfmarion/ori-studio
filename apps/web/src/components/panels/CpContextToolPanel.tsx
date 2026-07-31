import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cpActionLabel, cpToolInstructions } from '../../i18n/cpVocab';
import { cpPaletteStatusLabel } from '../../i18n/paletteLabels';
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
import type { OristudioCpToolInstructions } from '../../lib/oristudioCpToolInstructions';
import { cpPaletteEntryForColor } from '../../lib/oristudioCpPalette';
import { cpLineAssignmentLabel, type OristudioCpSelection } from '../../lib/creasePatternViewport';
import { isSelectionCircleApplyOperation } from '../../cp-workspace/tools/predicates';
import { copyTextToClipboard } from '../../lib/clipboardText';
import { FoldAngleControl } from '../../cp-workspace/foldAngle/FoldAngleControl';
import {
  CP_ANGLE_UNITS,
  CP_MEASURE_UNITS,
  copyTextForCpMeasurement,
  cpMeasureKindForOperation,
  cpMeasureUnitIsPhysical,
  exactCpLengthLabel,
  formatCpMeasurement,
  type CpAngleUnit,
  type CpMeasureKind,
  type CpMeasureScale,
  type CpMeasureUnit,
  type CpMeasurement,
} from '../../cp-workspace/measure';

const identityTranslate = ((_key: string, defaultValue?: string) =>
  defaultValue ?? _key) as unknown as TFunction;

/** Literal-key `t()` calls so the extractor sees both measure-kind labels. */
function measureKindLabel(t: TFunction, kind: CpMeasureKind): string {
  return kind === 'angle'
    ? t('tools:cpContext.measureKindAngle', 'Angle')
    : t('tools:cpContext.measureKindDistance', 'Distance');
}

/** Literal-key `t()` calls so the extractor sees both angle-unit names. */
function angleUnitLabel(t: TFunction, unit: CpAngleUnit): string {
  return unit === 'rad'
    ? t('tools:cpContext.measureAngleUnitRad', 'Radians')
    : t('tools:cpContext.measureAngleUnitDeg', 'Degrees');
}

/** Literal-key `t()` calls so the extractor sees every unit name. */
function measureUnitLabel(t: TFunction, unit: CpMeasureUnit): string {
  switch (unit) {
    case 'paper':
      return t('tools:cpContext.measureUnitPaper', 'Paper edge = 1');
    case 'grid':
      return t('tools:cpContext.measureUnitGrid', 'Grid squares');
    case 'mm':
      return t('tools:cpContext.measureUnitMm', 'Millimetres');
    case 'cm':
      return t('tools:cpContext.measureUnitCm', 'Centimetres');
    case 'in':
      return t('tools:cpContext.measureUnitIn', 'Inches');
    case 'model':
      return t('tools:cpContext.measureUnitModel', 'Model units (Oriedita)');
  }
}

export function cpLineTypeStatusLabel(
  lineColor: OristudioCpLineColor,
  t: TFunction = identityTranslate
): string {
  const entry = cpPaletteEntryForColor(lineColor);
  return entry ? cpPaletteStatusLabel(t, entry) : `Line ${cpLineAssignmentLabel(lineColor)}`;
}

export function cpCommandRequiresContextApply(command: OristudioCpCommandDefinition): boolean {
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
  measurements,
  onHoverMeasurement,
  measureUnit,
  measureAngleUnit,
  measureScale,
  onMeasureUnitChange,
  onMeasureAngleUnitChange,
  onMeasurePaperEdgeMmChange,
  pendingPointCount,
  selection,
  onApply,
  onClearInput,
}: {
  action: OristudioCpActionDefinition | undefined;
  command: OristudioCpCommandDefinition;
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  activeLineColor: OristudioCpLineColor;
  measurements: readonly CpMeasurement[];
  /** Highlight a session measurement on the canvas while its row is hovered. */
  onHoverMeasurement: (index: number | null) => void;
  measureUnit: CpMeasureUnit;
  measureAngleUnit: CpAngleUnit;
  measureScale: CpMeasureScale;
  onMeasureUnitChange: (unit: CpMeasureUnit) => void;
  onMeasureAngleUnitChange: (unit: CpAngleUnit) => void;
  onMeasurePaperEdgeMmChange: (paperEdgeMm: number) => void;
  pendingPointCount: number;
  selection: OristudioCpSelection;
  onApply?: () => void;
  onClearInput?: () => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const groups = cpToolSettingGroupsForCommand(command);
  const instructions = cpToolInstructions(t, action, command);
  const applyDisabled = contextApplyDisabledForCommand(command, selection, pendingPointCount);
  const title = action?.kind === 'command' ? cpActionLabel(t, action) : command.label;
  const meta =
    groups.length > 0
      ? groups.length === 1
        ? t('tools:cpContext.settingCountOne', '{{count}} setting', { count: groups.length })
        : t('tools:cpContext.settingCountOther', '{{count}} settings', { count: groups.length })
      : t('tools:cpContext.instructions', 'Instructions');

  if (groups.length === 0 && !instructions) return null;

  return (
    <section
      className="cp-context-panel"
      aria-label={t('tools:cpContext.ariaLabel', 'Crease pattern tool options')}
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
              activeOperationId={command.operationId}
              measurements={measurements}
              onHoverMeasurement={onHoverMeasurement}
              measureUnit={measureUnit}
              measureAngleUnit={measureAngleUnit}
              measureScale={measureScale}
              onMeasureUnitChange={onMeasureUnitChange}
              onMeasureAngleUnitChange={onMeasureAngleUnitChange}
              onMeasurePaperEdgeMmChange={onMeasurePaperEdgeMmChange}
              pendingPointCount={pendingPointCount}
              selection={selection}
            />
          ))}
          {/* Selection-scoped, so it renders outside `groups` -- the active
              tool does not decide whether you can set a fold angle. */}
          <FoldAngleControl />
          {onApply && (
            <button
              className="cp-context-panel__apply"
              type="button"
              disabled={applyDisabled}
              onClick={onApply}
            >
              {command.operationId === 'VoronoiCreate'
                ? t('tools:cpContext.applyVoronoi', 'Apply Voronoi')
                : command.operationId === 'CircleChangeColor'
                  ? t('tools:cpContext.applyColor', 'Apply color')
                  : isSelectionCircleApplyOperation(command.operationId)
                    ? t('tools:cpContext.applyCircle', 'Apply circle')
                    : t('tools:cpContext.applyToSelection', 'Apply to selection')}
            </button>
          )}
          {onClearInput && (
            <button className="cp-context-panel__secondary" type="button" onClick={onClearInput}>
              {t('tools:cpContext.clearSeeds', 'Clear seeds')}
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
  const { t } = useTranslation();
  const hasIntro = (instructions.intro?.length ?? 0) > 0;
  const hasSteps = (instructions.steps?.length ?? 0) > 0;
  const hasNotes = (instructions.notes?.length ?? 0) > 0;

  return (
    <div className="cp-context-panel__instructions">
      <div className="cp-context-panel__group-title">{t('tools:cpContext.instructions', 'Instructions')}</div>
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

/**
 * Copy a measurement and say what happened: a copy with no feedback reads as a dead
 * click. Upstream pops a temporary "Copied" label on the measure field
 * (`TextFieldTempPopupAdapter`); this is the same idea on the value button, plus a
 * failure state so a blocked clipboard is visible instead of silent.
 */
type CopyStatus = 'idle' | 'copied' | 'failed';

function useCopyStatus(): [CopyStatus, (text: string) => void] {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const copy = useCallback((text: string) => {
    void copyTextToClipboard(text).then((copied) => {
      setStatus(copied ? 'copied' : 'failed');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus('idle'), 1200);
    });
  }, []);
  return [status, copy];
}

function CpContextToolGroup({
  group,
  options,
  setOptions,
  activeLineColor,
  activeOperationId,
  measurements,
  onHoverMeasurement,
  measureUnit,
  measureAngleUnit,
  measureScale,
  onMeasureUnitChange,
  onMeasureAngleUnitChange,
  onMeasurePaperEdgeMmChange,
  pendingPointCount,
  selection,
}: {
  group: OristudioCpToolSettingGroup;
  options: OristudioCpToolOptions;
  setOptions: Dispatch<SetStateAction<OristudioCpToolOptions>>;
  activeLineColor: OristudioCpLineColor;
  activeOperationId: OristudioCpCommandDefinition['operationId'];
  measurements: readonly CpMeasurement[];
  onHoverMeasurement: (index: number | null) => void;
  measureUnit: CpMeasureUnit;
  measureAngleUnit: CpAngleUnit;
  measureScale: CpMeasureScale;
  onMeasureUnitChange: (unit: CpMeasureUnit) => void;
  onMeasureAngleUnitChange: (unit: CpAngleUnit) => void;
  onMeasurePaperEdgeMmChange: (paperEdgeMm: number) => void;
  pendingPointCount: number;
  selection: OristudioCpSelection;
}) {
  const { t } = useTranslation();
  const [copyStatus, copyMeasurement] = useCopyStatus();
  if (group === 'line-color') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">{t('tools:cpContext.lineType', 'Line type')}</div>
        <div className="cp-context-panel__readout">{cpLineTypeStatusLabel(activeLineColor, t)}</div>
      </div>
    );
  }

  if (group === 'division-count') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">{t('tools:cpContext.divideByCount', 'Divide by count')}</div>
        <NumericToolOption
          label={t('tools:cpContext.count', 'Count')}
          ariaLabel={t('tools:cpContext.divisionCount', 'Division count')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.angleSystem', 'Angle system')}</div>
        <NumericToolOption
          label={t('tools:cpContext.divider', 'Divider')}
          ariaLabel={t('tools:cpContext.angleSystemDivider', 'Angle system divider')}
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
              ariaLabel={t('tools:cpContext.angleFieldAria', 'Angle {{letter}}', { letter: field })}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.replaceLineType', 'Replace line type')}</div>
        <SelectToolOption
          label={t('tools:cpContext.from', 'From')}
          ariaLabel={t('tools:cpContext.replaceFromLineType', 'Replace from line type')}
          value={options.customFromLineType}
          options={ORISTUDIO_CP_CUSTOM_LINE_TYPE_OPTIONS}
          onChange={(customFromLineType) =>
            setOptions((current) => ({ ...current, customFromLineType }))
          }
        />
        <SelectToolOption
          label={t('tools:cpContext.to', 'To')}
          ariaLabel={t('tools:cpContext.replaceToLineType', 'Replace to line type')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.deleteLineType', 'Delete line type')}</div>
        <SelectToolOption
          label={t('tools:cpContext.filter', 'Filter')}
          ariaLabel={t('tools:cpContext.deleteLineTypeAria', 'Delete line type')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.erase', 'Erase')}</div>
        <SelectToolOption
          label={t('tools:cpContext.filter', 'Filter')}
          ariaLabel={t('tools:cpContext.eraseLineType', 'Erase line type')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.fixInaccurate', 'Fix inaccurate')}</div>
        <NumericToolOption
          label={t('tools:cpContext.precision', 'Precision')}
          ariaLabel={t('tools:cpContext.fixPrecision', 'Fix precision')}
          min={0}
          max={100}
          step={0.01}
          value={options.fixPrecision}
          onChange={(fixPrecision) => setOptions((current) => ({ ...current, fixPrecision }))}
        />
        <CheckboxToolOption
          label="BP"
          ariaLabel={t('tools:cpContext.useBpFixTargets', 'Use BP fix targets')}
          checked={options.fixPrecisionUseBp}
          onChange={(fixPrecisionUseBp) =>
            setOptions((current) => ({ ...current, fixPrecisionUseBp }))
          }
        />
        <CheckboxToolOption
          label="22.5"
          ariaLabel={t('tools:cpContext.use225FixTargets', 'Use 22.5 fix targets')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.regularPolygon', 'Regular polygon')}</div>
        <NumericToolOption
          label={t('tools:cpContext.corners', 'Corners')}
          ariaLabel={t('tools:cpContext.polygonCorners', 'Polygon corners')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.parallelWidth', 'Parallel width')}</div>
        <NumericToolOption
          label={t('tools:cpContext.width', 'Width')}
          ariaLabel={t('tools:cpContext.parallelWidthAria', 'Parallel width')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.candidate', 'Candidate')}</div>
        <CheckboxToolOption
          label={
            usesNearestCandidate
              ? t('tools:cpContext.autoNearest', 'Auto nearest')
              : t('tools:cpContext.firstCandidate', 'First candidate')
          }
          ariaLabel={
            usesNearestCandidate
              ? t('tools:cpContext.useNearestCandidate', 'Use nearest candidate')
              : t('tools:cpContext.useFirstCandidate', 'Use first candidate')
          }
          checked={options.candidateIndex === null}
          onChange={(useNearest) =>
            setOptions((current) => ({
              ...current,
              candidateIndex: useNearest ? null : 0,
            }))
          }
        />
        <NumericToolOption
          label={t('tools:cpContext.index', 'Index')}
          ariaLabel={t('tools:cpContext.candidateIndex', 'Candidate index')}
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
        <div className="cp-context-panel__group-title">{t('tools:cpContext.circleSelection', 'Circle selection')}</div>
        <div className="cp-context-panel__readout">
          {selection.circles.length === 1
            ? t('tools:cpContext.circlesSelectedOne', '{{count}} circle selected', {
                count: selection.circles.length,
              })
            : t('tools:cpContext.circlesSelectedOther', '{{count}} circles selected', {
                count: selection.circles.length,
              })}
          {selection.lines.length > 0
            ? selection.lines.length === 1
              ? t('tools:cpContext.creasesSelectedOne', ', {{count}} crease selected', {
                  count: selection.lines.length,
                })
              : t('tools:cpContext.creasesSelectedOther', ', {{count}} creases selected', {
                  count: selection.lines.length,
                })
            : ''}
        </div>
      </div>
    );
  }

  if (group === 'apply-lines') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">
          {activeOperationId === 'VoronoiCreate'
            ? t('tools:cpContext.voronoiSeeds', 'Voronoi seeds')
            : t('tools:cpContext.applyLines', 'Apply lines')}
        </div>
        <div className="cp-context-panel__readout">
          {activeOperationId === 'VoronoiCreate'
            ? pendingPointCount === 1
              ? t('tools:cpContext.seedPressPendingOne', '{{count}} seed press pending', {
                  count: pendingPointCount,
                })
              : t('tools:cpContext.seedPressPendingOther', '{{count}} seed presses pending', {
                  count: pendingPointCount,
                })
            : t('tools:cpContext.applyGeneratedLines', 'Apply the generated lines from this tool.')}
        </div>
      </div>
    );
  }

  if (group === 'measure') {
    // Which measure tool is active decides the kind — Measure Length and Measure
    // Angle are separate tools, so there is nothing to choose here.
    const kind = cpMeasureKindForOperation(activeOperationId) ?? 'distance';
    // Newest first: the reading just taken is the one being read, and older ones
    // stay available for comparison until the tool is left.
    const rows = measurements.map((entry, index) => ({ entry, index })).reverse();
    const latest = rows[0];
    const exactLabel =
      latest && latest.entry.kind === 'distance'
        ? exactCpLengthLabel(latest.entry.value, measureScale)
        : null;
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">{t('tools:cpContext.measure', 'Measure')}</div>
        <button
          type="button"
          className="cp-context-panel__measure-value"
          data-empty={latest === undefined || undefined}
          disabled={latest === undefined}
          aria-live="polite"
          title={
            latest ? t('tools:cpContext.measureCopy', 'Copy the full-precision value') : undefined
          }
          data-copy-status={copyStatus === 'idle' ? undefined : copyStatus}
          onMouseEnter={() => latest && onHoverMeasurement(latest.index)}
          onMouseLeave={() => onHoverMeasurement(null)}
          onClick={() => {
            if (!latest) return;
            copyMeasurement(copyTextForCpMeasurement(latest.entry, measureUnit, measureScale, measureAngleUnit));
          }}
        >
          {latest === undefined
            ? t('tools:cpContext.measureEmpty', 'No measurement yet')
            : formatCpMeasurement(latest.entry, measureUnit, measureScale, measureAngleUnit)}
          {copyStatus !== 'idle' && (
            <span className="cp-context-panel__measure-copied" data-copy-status={copyStatus}>
              {copyStatus === 'copied'
                ? t('tools:cpContext.measureCopied', 'Copied')
                : t('tools:cpContext.measureCopyFailed', 'Copy blocked')}
            </span>
          )}
        </button>
        {exactLabel && (
          <div className="cp-context-panel__readout cp-context-panel__measure-exact">
            {t('tools:cpContext.measureExact', 'about {{exact}} of the paper edge', {
              exact: exactLabel,
            })}
          </div>
        )}
        {rows.length > 1 && (
          <ul className="cp-context-panel__measure-list">
            {rows.slice(1).map(({ entry, index }) => (
              <li key={index}>
                <button
                  type="button"
                  className="cp-context-panel__measure-row"
                  onMouseEnter={() => onHoverMeasurement(index)}
                  onMouseLeave={() => onHoverMeasurement(null)}
                  onClick={() =>
                    copyMeasurement(copyTextForCpMeasurement(entry, measureUnit, measureScale, measureAngleUnit))
                  }
                >
                  <span>{measureKindLabel(t, entry.kind)}</span>
                  <span>{formatCpMeasurement(entry, measureUnit, measureScale, measureAngleUnit)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {kind === 'angle' ? (
          <label className="cp-context-panel__field">
            <span>{t('tools:cpContext.measureUnit', 'Units')}</span>
            <select
              aria-label={t('tools:cpContext.measureUnit', 'Units')}
              value={measureAngleUnit}
              onChange={(event) =>
                onMeasureAngleUnitChange(event.currentTarget.value as CpAngleUnit)
              }
            >
              {CP_ANGLE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {angleUnitLabel(t, unit)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="cp-context-panel__field">
              <span>{t('tools:cpContext.measureUnit', 'Units')}</span>
              <select
                aria-label={t('tools:cpContext.measureUnit', 'Units')}
                value={measureUnit}
                onChange={(event) => onMeasureUnitChange(event.currentTarget.value as CpMeasureUnit)}
              >
                {CP_MEASURE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {measureUnitLabel(t, unit)}
                  </option>
                ))}
              </select>
            </label>
            {cpMeasureUnitIsPhysical(measureUnit) && (
              <NumericToolOption
                label={t('tools:cpContext.measurePaperEdge', 'Paper edge (mm)')}
                ariaLabel={t('tools:cpContext.measurePaperEdge', 'Paper edge (mm)')}
                min={1}
                step={1}
                value={measureScale.paperEdgeMm}
                onChange={onMeasurePaperEdgeMmChange}
              />
            )}
          </>
        )}
        {rows.length > 0 && (
          <div className="cp-context-panel__readout">
            {t('tools:cpContext.measureClearHint', 'Backspace removes the last, Escape clears all')}
          </div>
        )}
      </div>
    );
  }

  if (group === 'custom-circle-color') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">{t('tools:cpContext.circleColor', 'Circle color')}</div>
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
              ariaLabel={circleColorAria(t, field.key)}
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

  if (group === 'line-select-help') {
    return (
      <div className="cp-context-panel__group">
        <div className="cp-context-panel__group-title">{t('tools:cpContext.lineSelection', 'Line selection')}</div>
        <div className="cp-context-panel__readout">{t('tools:cpContext.dragAcrossCreases', 'Drag across creases to apply this action.')}</div>
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
  const { t } = useTranslation();
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
      <div className="cp-context-panel__group-title">{t('tools:cpContext.divideByRatio', 'Divide by ratio')}</div>
      <div className="cp-context-panel__ratio-simple">
        <TextToolOption
          label={t('tools:cpContext.left', 'Left')}
          ariaLabel={t('tools:cpContext.leftSegmentRatio', 'Left segment ratio')}
          value={leftDraft}
          invalid={leftInvalid}
          onChange={(value) => updateSimpleHalf('left', value)}
        />
        <TextToolOption
          label={t('tools:cpContext.right', 'Right')}
          ariaLabel={t('tools:cpContext.rightSegmentRatio', 'Right segment ratio')}
          value={rightDraft}
          invalid={rightInvalid}
          onChange={(value) => updateSimpleHalf('right', value)}
        />
      </div>
      <div className="cp-context-panel__preset-grid" aria-label={t('tools:cpContext.ratioPresets', 'Ratio presets')}>
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
        {t('tools:cpContext.computedRatio', 'Computed ratio {{s}} : {{t}}', {
          s: formatOrieditaRatioNumber(ratio.ratioS),
          t: formatOrieditaRatioNumber(ratio.ratioT),
        })}
      </div>
      <details className="cp-context-panel__details">
        <summary>{t('tools:cpContext.exactForm', 'Exact form')}</summary>
        <div className="cp-context-panel__ratio-grid">
          {RATIO_FIELDS.map((field) => (
            <NumericToolOption
              key={field.key}
              label={field.label}
              ariaLabel={t('tools:cpContext.ratioFieldAria', 'Ratio {{letter}}', { letter: field.label })}
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
}[] = [
  { key: 'red', label: 'R' },
  { key: 'green', label: 'G' },
  { key: 'blue', label: 'B' },
];

function circleColorAria(t: TFunction, key: keyof OristudioCpRgbColor): string {
  switch (key) {
    case 'red':
      return t('tools:cpContext.circleColorRed', 'Circle color red');
    case 'green':
      return t('tools:cpContext.circleColorGreen', 'Circle color green');
    case 'blue':
      return t('tools:cpContext.circleColorBlue', 'Circle color blue');
    default:
      return key;
  }
}

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
