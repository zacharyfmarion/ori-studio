import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import {
  SIMULATOR_SETTING_RANGES,
  type SimulatorNumericSettingKey,
  type SimulatorSettings,
} from '../../lib/simulatorSettings';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Slider } from '../ui/Slider';
import { Toggle } from '../ui/Toggle';

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

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="simulator-view-controls-panel__section">
      <div className="simulator-view-controls-panel__section-header">
        <span className="simulator-view-controls-panel__section-title">{title}</span>
        {action}
      </div>
      {description && (
        <p className="simulator-view-controls-panel__section-hint">{description}</p>
      )}
      {children}
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
