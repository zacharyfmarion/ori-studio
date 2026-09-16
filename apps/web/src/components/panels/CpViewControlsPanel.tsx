import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import type { OristudioCpGridMetadata } from '../../engine/oristudioCpTypes';
import {
  clampOrieditaGridAngle,
  clampOristudioCpLineWidth,
  clampOristudioCpPointSize,
  DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY,
  normalizeOrieditaGridSize,
  normalizeOrieditaIntervalGridSize,
  ORIEDITA_GRID_SCALE_DEFAULTS,
  ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS,
  ORISTUDIO_CP_LINE_STYLES,
  ORISTUDIO_CP_MAX_LINE_WIDTH,
  ORISTUDIO_CP_MAX_POINT_SIZE,
  ORISTUDIO_CP_MIN_LINE_WIDTH,
  ORISTUDIO_CP_MIN_POINT_SIZE,
  type OristudioCpFoldAngleDisplay,
  type OristudioCpLineStyle,
} from '../../lib/creasePatternViewport';
import { CP_CHECK_CLASSES, type CpCheckClass } from '../../cp-workspace/annotations/suppressionRegion';
import { cpCheckClassLabel } from '../../cp-workspace/diagnostics/checkSuppression';
import { cpFoldAngleDisplayLabel, cpLineStyleLabel } from '../../i18n/enumLabels';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { NumberField } from '../ui/NumberField';
import { NumberRow, SelectRow, ToggleRow } from '../ui/fieldRows';

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
  const foldAngleLabelsVisible = viewport.foldAngleLabelsVisible !== false;
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
            label={t('panels:cpViewControls.camvIssues', 'Foldability issues')}
            checked={camvVisible}
            onChange={(checked) => setViewportOption('camvIssuesVisible', checked)}
          />
          {/* The document-wide check-suppression rule. The master toggle above
              keeps meaning exactly what it always meant — with it off nothing is
              drawn, and every class row below reads off with it. */}
          <CheckClassSection
            overlayVisible={camvVisible}
            suppressed={viewport.suppressedCheckClasses}
            onSuppressedChange={(next) => setViewportOption('suppressedCheckClasses', next)}
          />
          {/* Which channel carries the angle — never whether one does, so there
              is no "off" here. */}
          <FoldAngleDisplayRow
            value={viewport.foldAngleDisplay ?? DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY}
            onChange={(display) => setViewportOption('foldAngleDisplay', display)}
          />
          {/* Labels only. Crease ink always distinguishes a non-180 crease,
              which is why this is not called "fold angles". */}
          <ToggleRow
            label={t('panels:cpViewControls.foldAngleLabels', 'Fold angle labels')}
            checked={foldAngleLabelsVisible}
            onChange={(checked) => setViewportOption('foldAngleLabelsVisible', checked)}
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

  const update = (patch: Partial<OristudioCpGridMetadata>, label?: string) => {
    void onUpdate(patch, label);
  };

  return (
    <CollapsibleSection
      collapsible
      title={t('panels:cpViewControls.moreGridSettings', 'More grid settings')}
      bodyLabel={t('panels:cpViewControls.gridConfiguration', 'Grid configuration')}
    >
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
    </CollapsibleSection>
  );
}

function FoldAngleDisplayRow({
  value,
  onChange,
}: {
  value: OristudioCpFoldAngleDisplay;
  onChange: (value: OristudioCpFoldAngleDisplay) => void;
}) {
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t('panels:cpViewControls.foldAngleDisplay', 'Fold angle style')}
      value={value}
      options={ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS.map((display) => ({
        id: display,
        label: cpFoldAngleDisplayLabel(t, display),
      }))}
      onChange={(next) => onChange(next as OristudioCpFoldAngleDisplay)}
    />
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
    <SelectRow
      label={t('panels:cpViewControls.lineStyle', 'Line style')}
      value={value}
      options={ORISTUDIO_CP_LINE_STYLES.map((style) => ({
        id: style,
        label: cpLineStyleLabel(t, style),
      }))}
      onChange={(next) => onChange(next as OristudioCpLineStyle)}
    />
  );
}

/**
 * The per-class half of the document-wide check-suppression rule.
 *
 * Each row is a **show** switch for one theorem, so the natural reading — on
 * means "tell me about this" — matches what the stored list is the complement
 * of. Named after the theorems rather than after the kernel's rule codes,
 * because the decision the user is making is whether a condition applies to what
 * they are doing, and "Angles" does not say "Kawasaki" to anyone who has not
 * read `checks.rs`.
 *
 * There is no row for an odd fan (`NumberOfFolds`). It is combinatorial and is
 * 74% of a repair worklist, so no state exists in which hiding it is right —
 * see `cp-workspace/diagnostics/checkSuppression.ts`.
 *
 * Disabled and off while the overlay itself is off, so "everything here is off"
 * is exactly the old boolean's `false` and there is no second, contradicting
 * representation of it. Turning the overlay back on restores the class list the
 * user had.
 */
/**
 * The per-class rules, folded away behind a disclosure like the grid's.
 *
 * Four rows is enough to push everything below them off the fold, and the
 * master "Foldability issues" toggle above is the control almost everyone
 * wants — the classes are for the case where you need one theorem quiet while
 * the rest keep working. Collapsed by default for the same reason
 * {@link GridSettingsSection} is, and built the same way so the two disclosures
 * behave identically.
 */
function CheckClassSection({
  overlayVisible,
  suppressed,
  onSuppressedChange,
}: {
  overlayVisible: boolean;
  suppressed: readonly CpCheckClass[] | undefined;
  onSuppressedChange: (next: readonly CpCheckClass[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <CollapsibleSection
      collapsible
      title={t('panels:cpViewControls.moreFoldabilitySettings', 'More foldability settings')}
      bodyLabel={t('panels:cpViewControls.foldabilityChecks', 'Foldability checks')}
    >
      <CheckClassRows
        overlayVisible={overlayVisible}
        suppressed={suppressed}
        onSuppressedChange={onSuppressedChange}
      />
    </CollapsibleSection>
  );
}

function CheckClassRows({
  overlayVisible,
  suppressed,
  onSuppressedChange,
}: {
  overlayVisible: boolean;
  suppressed: readonly CpCheckClass[] | undefined;
  onSuppressedChange: (next: readonly CpCheckClass[]) => void;
}) {
  const { t } = useTranslation();
  const suppressedList = suppressed ?? [];
  return (
    <>
      {CP_CHECK_CLASSES.map((checkClass) => {
        const label = cpCheckClassLabel(t, checkClass);
        const shown = !suppressedList.includes(checkClass);
        return (
          <ToggleRow
            key={checkClass}
            label={label}
            checked={overlayVisible && shown}
            disabled={!overlayVisible}
            onChange={(checked) =>
              onSuppressedChange(
                // Rebuilt from the canonical order rather than pushed/spliced, so
                // two documents suppressing the same set hold the same array.
                CP_CHECK_CLASSES.filter((candidate) =>
                  candidate === checkClass ? !checked : suppressedList.includes(candidate)
                )
              )
            }
          />
        );
      })}
    </>
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
  const { t } = useTranslation();
  return (
    <div className="grid-scale-row">
      <span className="grid-scale-row__label">{label}</span>
      {/* Three fields and two operators on one line — no room for step buttons,
          so these stay type-and-commit fields. */}
      <div className="grid-scale-row__formula">
        <NumberField
          label={t('panels:cpViewControls.gridConstantTerm', '{{label}} constant term', { label })}
          className="grid-scale-row__input"
          value={a}
          step={0.1}
          steppers={false}
          onCommit={(next) => onChange(next, b, c)}
        />
        <span className="grid-scale-row__op" aria-hidden="true">
          +
        </span>
        <NumberField
          label={t('panels:cpViewControls.gridRootCoefficient', '{{label}} root coefficient', { label })}
          className="grid-scale-row__input"
          value={b}
          step={0.1}
          steppers={false}
          onCommit={(next) => onChange(a, next, c)}
        />
        <span className="grid-scale-row__op" aria-hidden="true">
          √
        </span>
        <NumberField
          label={t('panels:cpViewControls.gridRadicand', '{{label}} radicand', { label })}
          className="grid-scale-row__input"
          value={c}
          min={0}
          step={0.1}
          steppers={false}
          onCommit={(next) => onChange(a, b, next)}
        />
      </div>
    </div>
  );
}
