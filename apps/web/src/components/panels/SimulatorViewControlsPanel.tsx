import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronRight, RotateCcw } from 'lucide-react';
import {
  SIMULATOR_CREASE_STYLES,
  SIMULATOR_SETTING_RANGES,
  type SimulatorColorSettingKey,
  type SimulatorCreaseStyle,
  type SimulatorExportBackground,
  type SimulatorNumericSettingKey,
  type SimulatorSettings,
} from '../../lib/simulatorSettings';
import { simulatorStyleDefaults } from '../../simulator/simulatorPalette';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useThemeStore } from '../../store/themeStore';
import { ColorField } from '../ui/ColorField';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { Toggle } from '../ui/Toggle';

// Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
function creaseStyleLabel(value: SimulatorCreaseStyle, t: TFunction): string {
  switch (value) {
    case 'color':
      return t('panels:simulatorViewControls.creaseStyleColor', 'Mountain / valley');
    case 'mono':
      return t('panels:simulatorViewControls.creaseStyleMono', 'One ink');
    case 'mono-dashed':
      return t('panels:simulatorViewControls.creaseStyleMonoDashed', 'One ink, dashed');
  }
}

function exportBackgroundLabel(value: SimulatorExportBackground, t: TFunction): string {
  switch (value) {
    case 'transparent':
      return t('panels:simulatorViewControls.backgroundTransparent', 'Transparent');
    case 'white':
      return t('panels:simulatorViewControls.backgroundWhite', 'White');
    case 'theme':
      return t('panels:simulatorViewControls.backgroundTheme', 'Match theme');
  }
}

/**
 * Options pane for the Simulate workspace, mirroring the Edit workspace's view
 * pane. Render options are applied by the simulator panel; material and solver
 * options go to the engine live (both backends recompute their timestep on a
 * material change), so nothing here reloads the model.
 */
export function SimulatorViewControlsPanel() {
  const { t } = useTranslation();
  const settings = useWorkspaceStore((state) => state.simulatorSettings);
  const setSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  const resetMaterial = useWorkspaceStore((state) => state.resetSimulatorMaterial);
  const resetStyle = useWorkspaceStore((state) => state.resetSimulatorStyle);
  // What an unset colour actually resolves to, so a swatch shows the paper the
  // user is looking at rather than a hardcoded guess. Keyed on the theme because
  // that is what moves them.
  const theme = useThemeStore((state) => state.currentTheme);
  const styleDefaults = useMemo(
    () =>
      simulatorStyleDefaults(
        typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );
  // A mono style paints every crease in the edge ink, so the per-kind swatches
  // stop doing anything; showing them live would promise an effect they no
  // longer have.
  const monoCreases = settings.creaseStyle !== 'color';
  const colorRow = (key: SimulatorColorSettingKey, label: string, disabled = false) => (
    <ColorField
      label={label}
      layout="row"
      value={settings[key] ?? styleDefaults[key]}
      disabled={disabled}
      onChange={(value) => setSetting(key, value)}
      onClear={settings[key] === null ? undefined : () => setSetting(key, null)}
    />
  );

  return (
    <section className="panel-shell simulator-view-controls-panel">
      <div className="panel-body simulator-view-controls-panel__body">
        <Section title={t('panels:simulatorViewControls.render', 'Render')}>
          <div className="control-row">
            <span className="control-row__label">
              {t('panels:simulatorViewControls.style', 'Style')}
            </span>
            <div className="control-row__value">
              <Select
                value={settings.renderMode}
                onValueChange={(value) =>
                  setSetting('renderMode', value as SimulatorSettings['renderMode'])
                }
              >
                <SelectTrigger
                  aria-label={t('panels:simulatorViewControls.style', 'Style')}
                  className="simulator-view-controls-panel__select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">
                    {t('panels:simulatorViewControls.stylePaper', 'Paper')}
                  </SelectItem>
                  <SelectItem value="xray">
                    {t('panels:simulatorViewControls.styleXray', 'X-ray')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="control-row">
            <span className="control-row__label">
              {t('panels:simulatorViewControls.colorMode', 'Colour')}
            </span>
            <div className="control-row__value">
              <Select
                value={settings.colorMode}
                onValueChange={(value) =>
                  setSetting('colorMode', value as SimulatorSettings['colorMode'])
                }
              >
                <SelectTrigger
                  aria-label={t('panels:simulatorViewControls.colorMode', 'Colour')}
                  className="simulator-view-controls-panel__select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paper">
                    {t('panels:simulatorViewControls.colorPaper', 'Paper')}
                  </SelectItem>
                  <SelectItem value="strain">
                    {t('panels:simulatorViewControls.colorStrain', 'Strain')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {settings.colorMode === 'strain' && (
            <SliderRow
              settingKey="strainClip"
              label={t('panels:simulatorViewControls.strainClip', 'Red at %')}
              settings={settings}
              setSetting={setSetting}
            />
          )}
          <ToggleRow
            label={t('panels:simulatorViewControls.faces', 'Faces')}
            checked={settings.showFaces}
            onChange={(checked) => setSetting('showFaces', checked)}
          />
          <ToggleRow
            label={t('panels:simulatorViewControls.creaseLines', 'Crease lines')}
            checked={settings.showEdges}
            onChange={(checked) => setSetting('showEdges', checked)}
          />
          <ToggleRow
            label={t('panels:simulatorViewControls.hiddenLines', 'Hidden lines')}
            checked={settings.showHiddenLines}
            disabled={!settings.showEdges}
            onChange={(checked) => setSetting('showHiddenLines', checked)}
          />
          <ToggleRow
            label={t('panels:simulatorViewControls.lighting', 'Lighting')}
            checked={settings.lighting}
            onChange={(checked) => setSetting('lighting', checked)}
          />
        </Section>

        <Section
          title={t('panels:simulatorViewControls.paper', 'Paper')}
          collapsible
          action={
            <button
              type="button"
              className="simulator-view-controls-panel__reset"
              title={t('panels:simulatorViewControls.resetStyle', 'Reset style')}
              aria-label={t('panels:simulatorViewControls.resetStyle', 'Reset style')}
              onClick={resetStyle}
            >
              <RotateCcw size={12} />
            </button>
          }
        >
          <div className="simulator-view-controls-panel__colors">
            {colorRow('paperFront', t('panels:simulatorViewControls.paperFront', 'Front'))}
            {colorRow('paperBack', t('panels:simulatorViewControls.paperBack', 'Back'))}
          </div>
        </Section>

        <Section title={t('panels:simulatorViewControls.creases', 'Creases')} collapsible>
          <div className="control-row">
            <span className="control-row__label">
              {t('panels:simulatorViewControls.creaseStyle', 'Style')}
            </span>
            <div className="control-row__value">
              <Select
                value={settings.creaseStyle}
                onValueChange={(value) =>
                  setSetting('creaseStyle', value as SimulatorCreaseStyle)
                }
              >
                <SelectTrigger
                  aria-label={t('panels:simulatorViewControls.creaseStyle', 'Style')}
                  className="simulator-view-controls-panel__select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIMULATOR_CREASE_STYLES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {creaseStyleLabel(value, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="simulator-view-controls-panel__colors">
            {colorRow(
              'mountainColor',
              t('panels:simulatorViewControls.mountain', 'Mountain'),
              monoCreases
            )}
            {colorRow(
              'valleyColor',
              t('panels:simulatorViewControls.valley', 'Valley'),
              monoCreases
            )}
            {colorRow('borderColor', t('panels:simulatorViewControls.borderEdge', 'Edge'))}
          </div>
          <SliderRow
            settingKey="creaseWidth"
            label={t('panels:simulatorViewControls.creaseWidth', 'Weight')}
            settings={settings}
            setSetting={setSetting}
          />
        </Section>

        <Section
          title={t('panels:simulatorViewControls.export', 'Export')}
          collapsible
          description={t(
            'panels:simulatorViewControls.exportHint',
            'Page background of an exported image.'
          )}
        >
          <div className="control-row">
            <span className="control-row__label">
              {t('panels:simulatorViewControls.background', 'Background')}
            </span>
            <div className="control-row__value">
              <Select
                value={settings.exportBackground}
                onValueChange={(value) =>
                  setSetting('exportBackground', value as SimulatorExportBackground)
                }
              >
                <SelectTrigger
                  aria-label={t('panels:simulatorViewControls.background', 'Background')}
                  className="simulator-view-controls-panel__select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['transparent', 'white', 'theme'] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {exportBackgroundLabel(value, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title={t('panels:simulatorViewControls.material', 'Material')}
          description={t(
            'panels:simulatorViewControls.materialHint',
            'How the paper resists stretching and folding.'
          )}
          action={
            <button
              type="button"
              className="simulator-view-controls-panel__reset"
              title={t('panels:simulatorViewControls.resetMaterial', 'Reset material')}
              aria-label={t('panels:simulatorViewControls.resetMaterial', 'Reset material')}
              onClick={resetMaterial}
            >
              <RotateCcw size={12} />
            </button>
          }
        >
          <SliderRow
            settingKey="axialStiffness"
            label={t('panels:simulatorViewControls.axialStiffness', 'Stretch')}
            settings={settings}
            setSetting={setSetting}
          />
          <SliderRow
            settingKey="creaseStiffness"
            label={t('panels:simulatorViewControls.creaseStiffness', 'Crease')}
            settings={settings}
            setSetting={setSetting}
          />
          <SliderRow
            settingKey="panelStiffness"
            label={t('panels:simulatorViewControls.panelStiffness', 'Facet')}
            settings={settings}
            setSetting={setSetting}
          />
          <SliderRow
            settingKey="faceStiffness"
            label={t('panels:simulatorViewControls.faceStiffness', 'Face')}
            settings={settings}
            setSetting={setSetting}
          />
          <SliderRow
            settingKey="damping"
            label={t('panels:simulatorViewControls.damping', 'Damping')}
            settings={settings}
            setSetting={setSetting}
          />
        </Section>

        <Section
          title={t('panels:simulatorViewControls.solver', 'Solver')}
          description={t(
            'panels:simulatorViewControls.solverHint',
            'Lower stability if a fold jitters or blows up.'
          )}
        >
          <SliderRow
            settingKey="timeStepScale"
            label={t('panels:simulatorViewControls.stability', 'Stability')}
            settings={settings}
            setSetting={setSetting}
            // Shown inverted: a smaller timestep is *more* stable, and a slider
            // labelled "stability" that decreases as you drag right would read
            // backwards.
            invert
          />
          <SliderRow
            settingKey="foldPlayPercentPerSecond"
            label={t('panels:simulatorViewControls.playSpeed', 'Play speed')}
            settings={settings}
            setSetting={setSetting}
          />
        </Section>
      </div>
    </section>
  );
}

/**
 * One group of options.
 *
 * `collapsible` sections start closed, following `GridSettingsSection` in the
 * Edit workspace's view pane — same chevron, same `data-open` hook, same
 * component-local state rather than a persisted preference. Styling is a set of
 * secondary controls that most sessions never touch, so they should not push the
 * ones that matter below the fold.
 */
function Section({
  title,
  description,
  action,
  collapsible = false,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const body = (
    <>
      {description && (
        <p className="simulator-view-controls-panel__section-hint">{description}</p>
      )}
      {children}
    </>
  );

  if (!collapsible) {
    return (
      <div className="simulator-view-controls-panel__section">
        <div className="simulator-view-controls-panel__section-header">
          <span className="simulator-view-controls-panel__section-title">{title}</span>
          {action}
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="simulator-view-controls-panel__section" data-open={open || undefined}>
      <div className="simulator-view-controls-panel__section-header">
        <button
          type="button"
          className="simulator-view-controls-panel__section-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight
            size={13}
            className="simulator-view-controls-panel__section-chevron"
            aria-hidden="true"
          />
          <span className="simulator-view-controls-panel__section-title">{title}</span>
        </button>
        {/* The action only makes sense against controls you can see. */}
        {open && action}
      </div>
      {open && body}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="control-row" data-disabled={disabled || undefined}>
      <span className="control-row__label">{label}</span>
      <div className="control-row__value control-row__value--toggle">
        <Toggle aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
      </div>
    </div>
  );
}

function SliderRow({
  settingKey,
  label,
  settings,
  setSetting,
  invert = false,
}: {
  settingKey: SimulatorNumericSettingKey;
  label: string;
  settings: SimulatorSettings;
  setSetting: <K extends SimulatorNumericSettingKey>(key: K, value: SimulatorSettings[K]) => void;
  invert?: boolean;
}) {
  const range = SIMULATOR_SETTING_RANGES[settingKey];
  const value = settings[settingKey];
  // An inverted slider maps its position back through the range, so the stored
  // value still means what the engine expects.
  const shown = invert ? range.min + range.max - value : value;
  return (
    <label className="control-row">
      <span className="control-row__label">{label}</span>
      <span className="control-row__value simulator-view-controls-panel__slider-value">
        <Slider
          aria-label={label}
          min={range.min}
          max={range.max}
          step={range.step}
          value={shown}
          onChange={(next) => setSetting(settingKey, invert ? range.min + range.max - next : next)}
        />
        <span className="simulator-view-controls-panel__number">
          {formatSettingValue(value, range.step)}
        </span>
      </span>
    </label>
  );
}

/** Show as many decimals as the step implies, so a 0.05 step does not read "0.7000000001". */
function formatSettingValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}
