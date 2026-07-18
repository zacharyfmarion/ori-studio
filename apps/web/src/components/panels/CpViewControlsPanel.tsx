import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, RotateCcw } from 'lucide-react';
import type { OristudioCpGridMetadata } from '../../engine/oristudioCpTypes';
import {
  clampOrieditaGridAngle,
  clampOristudioCpLineWidth,
  clampOristudioCpPointSize,
  normalizeOrieditaGridSize,
  normalizeOrieditaIntervalGridSize,
  ORIEDITA_GRID_SCALE_DEFAULTS,
  ORISTUDIO_CP_LINE_STYLES,
  ORISTUDIO_CP_LINE_STYLE_LABELS,
  ORISTUDIO_CP_MAX_LINE_WIDTH,
  ORISTUDIO_CP_MAX_POINT_SIZE,
  ORISTUDIO_CP_MIN_LINE_WIDTH,
  ORISTUDIO_CP_MIN_POINT_SIZE,
  type OristudioCpLineStyle,
} from '../../lib/creasePatternViewport';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Toggle } from '../ui/Toggle';
import { CP_TOOL_OPTIONS_PANE_SLOT_ID } from './cpToolOptionsPortal';

export function CpViewControlsPanel() {
  const { t } = useTranslation();
  const editableCp = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const viewport = useWorkspaceStore((state) => state.oristudioCpViewport);
  const setViewportOption = useWorkspaceStore((state) => state.setOristudioCpViewportOption);
  const setGridSize = useWorkspaceStore((state) => state.setOristudioCpGridSize);
  const updateGrid = useWorkspaceStore((state) => state.updateOristudioCpGrid);

  if (!editableCp) {
    return (
      <section className="panel-shell cp-view-controls-panel">
        <div className="panel-body cp-view-controls-panel__empty">
          <span className="empty-note">{t('panels:cpViewControls.emptyNote', 'Open an editable crease pattern to adjust view options.')}</span>
        </div>
      </section>
    );
  }

  const grid = editableCp.crease_pattern.grid;
  const gridSize = normalizeOrieditaGridSize(grid.grid_size);
  const camvVisible = viewport.camvIssuesVisible !== false;
  const snapEnabled =
    viewport.snapToGrid || viewport.snapToVertices || viewport.snapToLines;

  return (
    <section className="panel-shell cp-view-controls-panel">
      <div className="panel-body cp-view-controls-panel__body">
        <div className="cp-view-controls-panel__view-options">
          <ToggleRow
            label={t('panels:cpViewControls.grid', 'Grid')}
            checked={viewport.gridVisible}
            onChange={(checked) => setViewportOption('gridVisible', checked)}
          />
          <NumberRow
            label={t('panels:cpViewControls.gridSize', 'Grid size')}
            value={gridSize}
            min={1}
            step={1}
            normalize={normalizeOrieditaGridSize}
            onCommit={(value) => void setGridSize(value)}
          />
          <GridSettingsSection grid={grid} onUpdate={updateGrid} />
          <ToggleRow
            label={t('panels:cpViewControls.camvIssues', 'CAMV issues')}
            checked={camvVisible}
            onChange={(checked) => setViewportOption('camvIssuesVisible', checked)}
          />
          <ToggleRow
            label={t('panels:cpViewControls.snapping', 'Snapping')}
            checked={snapEnabled}
            onChange={(checked) => {
              setViewportOption('snapToGrid', checked);
              setViewportOption('snapToVertices', checked);
              setViewportOption('snapToLines', checked);
            }}
          />
          <LineStyleRow
            value={viewport.lineStyle ?? 'color'}
            onChange={(lineStyle) => setViewportOption('lineStyle', lineStyle)}
          />
          <NumberRow
            label={t('panels:cpViewControls.lineWidth', 'Line width')}
            value={viewport.lineWidth ?? 1}
            min={ORISTUDIO_CP_MIN_LINE_WIDTH}
            max={ORISTUDIO_CP_MAX_LINE_WIDTH}
            step={1}
            normalize={clampOristudioCpLineWidth}
            onCommit={(value) => setViewportOption('lineWidth', value)}
          />
          <NumberRow
            label={t('panels:cpViewControls.pointSize', 'Point size')}
            value={viewport.pointSize ?? 1}
            min={ORISTUDIO_CP_MIN_POINT_SIZE}
            max={ORISTUDIO_CP_MAX_POINT_SIZE}
            step={1}
            normalize={clampOristudioCpPointSize}
            onCommit={(value) => setViewportOption('pointSize', value)}
          />
        </div>
        <div
          id={CP_TOOL_OPTIONS_PANE_SLOT_ID}
          className="cp-view-controls-panel__tool-options-slot"
        />
      </div>
    </section>
  );
}

function GridSettingsSection({
  grid,
  onUpdate,
}: {
  grid: OristudioCpGridMetadata;
  onUpdate: (patch: Partial<OristudioCpGridMetadata>, label?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const update = (patch: Partial<OristudioCpGridMetadata>, label?: string) => {
    void onUpdate(patch, label);
  };

  return (
    <div className="grid-settings" data-open={open || undefined}>
      <button
        type="button"
        className="grid-settings__toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight size={14} className="grid-settings__chevron" aria-hidden="true" />
        <span>{t('panels:cpViewControls.moreGridSettings', 'More grid settings')}</span>
      </button>
      {open && (
        <div className="grid-settings__body" role="group" aria-label={t('panels:cpViewControls.gridConfiguration', 'Grid configuration')}>
          <NumberRow
            label={t('panels:cpViewControls.interval', 'Interval')}
            value={grid.interval_grid_size}
            min={1}
            step={1}
            normalize={normalizeOrieditaIntervalGridSize}
            onCommit={(value) =>
              update(
                { interval_grid_size: value },
                t('panels:cpViewControls.setGridInterval', 'Set grid interval to {{value}}', {
                  value: normalizeOrieditaIntervalGridSize(value),
                })
              )
            }
          />
          <NumberRow
            label={t('panels:cpViewControls.angle', 'Angle')}
            value={grid.grid_angle}
            min={1}
            max={179}
            step={1}
            suffix="°"
            normalize={clampOrieditaGridAngle}
            onCommit={(value) =>
              update(
                { grid_angle: value },
                t('panels:cpViewControls.setGridAngle', 'Set grid angle to {{value}}°', {
                  value: clampOrieditaGridAngle(value),
                })
              )
            }
          />
          <GridScaleRow
            label={t('panels:cpViewControls.xScale', 'X scale')}
            a={grid.grid_xa}
            b={grid.grid_xb}
            c={grid.grid_xc}
            onChange={(a, b, c) =>
              update({ grid_xa: a, grid_xb: b, grid_xc: c }, t('panels:cpViewControls.setGridXScale', 'Set grid X scale'))
            }
          />
          <GridScaleRow
            label={t('panels:cpViewControls.yScale', 'Y scale')}
            a={grid.grid_ya}
            b={grid.grid_yb}
            c={grid.grid_yc}
            onChange={(a, b, c) =>
              update({ grid_ya: a, grid_yb: b, grid_yc: c }, t('panels:cpViewControls.setGridYScale', 'Set grid Y scale'))
            }
          />
          <ToggleRow
            label={t('panels:cpViewControls.diagonalGridlines', 'Diagonal gridlines')}
            checked={grid.draw_diagonal_gridlines}
            onChange={(checked) =>
              update(
                { draw_diagonal_gridlines: checked },
                checked
                  ? t('panels:cpViewControls.showDiagonalGridlines', 'Show diagonal gridlines')
                  : t('panels:cpViewControls.hideDiagonalGridlines', 'Hide diagonal gridlines')
              )
            }
          />
          <button
            type="button"
            className="grid-settings__reset"
            onClick={() =>
              update(
                {
                  grid_xa: ORIEDITA_GRID_SCALE_DEFAULTS.a,
                  grid_xb: ORIEDITA_GRID_SCALE_DEFAULTS.b,
                  grid_xc: ORIEDITA_GRID_SCALE_DEFAULTS.c,
                  grid_ya: ORIEDITA_GRID_SCALE_DEFAULTS.a,
                  grid_yb: ORIEDITA_GRID_SCALE_DEFAULTS.b,
                  grid_yc: ORIEDITA_GRID_SCALE_DEFAULTS.c,
                  grid_angle: 90,
                },
                t('panels:cpViewControls.resetGridShape', 'Reset grid shape')
              )
            }
          >
            <RotateCcw size={13} />
            {t('panels:cpViewControls.resetGridShape', 'Reset grid shape')}
          </button>
        </div>
      )}
    </div>
  );
}

function LineStyleRow({
  value,
  onChange,
}: {
  value: OristudioCpLineStyle;
  onChange: (value: OristudioCpLineStyle) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="control-row">
      <span className="control-row__label">{t('panels:cpViewControls.lineStyle', 'Line style')}</span>
      <div className="control-row__value control-row__value--select">
        <Select value={value} onValueChange={(next) => onChange(next as OristudioCpLineStyle)}>
          <SelectTrigger aria-label={t('panels:cpViewControls.lineStyle', 'Line style')} className="cp-view-controls-panel__select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORISTUDIO_CP_LINE_STYLES.map((style) => (
              <SelectItem key={style} value={style}>
                {ORISTUDIO_CP_LINE_STYLE_LABELS[style]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="control-row">
      <span className="control-row__label">{label}</span>
      <div className="control-row__value control-row__value--toggle">
        <Toggle aria-label={label} checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  normalize,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  normalize?: (value: number) => number;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="control-row">
      <span className="control-row__label">{label}</span>
      <span className="control-row__value control-row__value--input">
        <CommittedNumberInput
          ariaLabel={label}
          value={value}
          min={min}
          max={max}
          step={step}
          normalize={normalize}
          onCommit={onCommit}
        />
        {suffix && <span className="control-row__suffix">{suffix}</span>}
      </span>
    </label>
  );
}

function GridScaleRow({
  label,
  a,
  b,
  c,
  onChange,
}: {
  label: string;
  a: number;
  b: number;
  c: number;
  onChange: (a: number, b: number, c: number) => void;
}) {
  return (
    <div className="grid-scale-row">
      <span className="grid-scale-row__label">{label}</span>
      <div className="grid-scale-row__formula">
        <CommittedNumberInput
          ariaLabel={`${label} constant term`}
          className="grid-scale-row__input"
          value={a}
          step={0.1}
          onCommit={(next) => onChange(next, b, c)}
        />
        <span className="grid-scale-row__op" aria-hidden="true">
          +
        </span>
        <CommittedNumberInput
          ariaLabel={`${label} root coefficient`}
          className="grid-scale-row__input"
          value={b}
          step={0.1}
          onCommit={(next) => onChange(a, next, c)}
        />
        <span className="grid-scale-row__op" aria-hidden="true">
          √
        </span>
        <CommittedNumberInput
          ariaLabel={`${label} radicand`}
          className="grid-scale-row__input"
          value={c}
          min={0}
          step={0.1}
          onCommit={(next) => onChange(a, b, next)}
        />
      </div>
    </div>
  );
}

function CommittedNumberInput({
  ariaLabel,
  value,
  min,
  max,
  step,
  normalize,
  className,
  onCommit,
}: {
  ariaLabel: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  normalize?: (value: number) => number;
  className?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatGridNumber(value));

  useEffect(() => {
    setDraft(formatGridNumber(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatGridNumber(value));
      return;
    }
    const nextValue = normalize ? normalize(parsed) : parsed;
    setDraft(formatGridNumber(nextValue));
    onCommit(nextValue);
  };

  return (
    <input
      className={`control-row__input ${className ?? ''}`.trim()}
      aria-label={ariaLabel}
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
          setDraft(formatGridNumber(value));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function formatGridNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}
