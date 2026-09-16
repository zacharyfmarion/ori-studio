import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { RotateCcw } from 'lucide-react';
import {
  SIMULATOR_CREASE_STYLES,
  SIMULATOR_SETTING_RANGES,
  type SimulatorColorSettingKey,
  type SimulatorCreaseStyle,
  type SimulatorExportBackground,
  type SimulatorNumericSettingKey,
  type SimulatorSettings,
} from '../../lib/simulatorSettings';
import { simulatorColorModeLabel, simulatorCreaseStyleLabel } from '../../i18n/enumLabels';
import { simulatorStyleDefaults } from '../../simulator/simulatorPalette';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useThemeStore } from '../../store/themeStore';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { ColorField } from '../ui/ColorField';
import { SelectRow, SliderRow, ToggleRow } from '../ui/fieldRows';

// Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
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
        <CollapsibleSection title={t('panels:simulatorViewControls.render', 'Render')}>
          <SelectRow
            label={t('panels:simulatorViewControls.style', 'Style')}
            value={settings.renderMode}
            options={[
              { id: 'paper', label: t('panels:simulatorViewControls.stylePaper', 'Paper') },
              { id: 'xray', label: t('panels:simulatorViewControls.styleXray', 'X-ray') },
            ]}
            onChange={(value) => setSetting('renderMode', value as SimulatorSettings['renderMode'])}
          />
          <SelectRow
            label={t('panels:simulatorViewControls.colorMode', 'Color')}
            value={settings.colorMode}
            options={(['paper', 'strain'] as const).map((mode) => ({
              id: mode,
              label: simulatorColorModeLabel(t, mode),
            }))}
            onChange={(value) => setSetting('colorMode', value as SimulatorSettings['colorMode'])}
          />
          {settings.colorMode === 'strain' && (
            <SettingSliderRow
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
          <ToggleRow
            label={t('panels:simulatorViewControls.viewCube', 'View cube')}
            checked={settings.showViewCube}
            onChange={(checked) => setSetting('showViewCube', checked)}
          />
        </CollapsibleSection>

        {/*
          Which way the model is up. The orbit is a turntable about the paper's
          *normal*, which is up for a flat sheet and is not for a model that
          stands — so a standing figure tumbles rather than turning, and dragging
          cannot fix it because yaw and pitch only move the eye on a sphere whose
          pole is fixed. These two verbs pick the pole.

          Both are offered unconditionally. Whether an upright is set lives in
          the viewport's own ref (it is session-only for a simulation), so this
          store-driven pane has nothing to gate on — and clearing when none is
          set is simply a reset, which is harmless. The folded figure's copy of
          this verb *can* gate, because its upright is document state.
        */}
        <CollapsibleSection
          title={t('panels:simulatorViewControls.paper', 'Paper')}
          collapsible
          action={
            <button
              type="button"
              className="collapsible-section__action"
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
        </CollapsibleSection>

        <CollapsibleSection title={t('panels:simulatorViewControls.creases', 'Creases')} collapsible>
          <SelectRow
            label={t('panels:simulatorViewControls.creaseStyle', 'Style')}
            value={settings.creaseStyle}
            options={SIMULATOR_CREASE_STYLES.map((value) => ({
              id: value,
              label: simulatorCreaseStyleLabel(t, value),
            }))}
            onChange={(value) => setSetting('creaseStyle', value as SimulatorCreaseStyle)}
          />
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
          <SettingSliderRow
            settingKey="creaseWidth"
            label={t('panels:simulatorViewControls.creaseWidth', 'Weight')}
            settings={settings}
            setSetting={setSetting}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={t('panels:simulatorViewControls.export', 'Export')}
          collapsible
          description={t(
            'panels:simulatorViewControls.exportHint',
            'Page background of an exported image.'
          )}
        >
          <SelectRow
            label={t('panels:simulatorViewControls.background', 'Background')}
            value={settings.exportBackground}
            options={(['transparent', 'white', 'theme'] as const).map((value) => ({
              id: value,
              label: exportBackgroundLabel(value, t),
            }))}
            onChange={(value) => setSetting('exportBackground', value as SimulatorExportBackground)}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={t('panels:simulatorViewControls.material', 'Material')}
          collapsible
          description={t(
            'panels:simulatorViewControls.materialHint',
            'How the paper resists stretching and folding.'
          )}
          action={
            <button
              type="button"
              className="collapsible-section__action"
              title={t('panels:simulatorViewControls.resetMaterial', 'Reset material')}
              aria-label={t('panels:simulatorViewControls.resetMaterial', 'Reset material')}
              onClick={resetMaterial}
            >
              <RotateCcw size={12} />
            </button>
          }
        >
          <SettingSliderRow
            settingKey="axialStiffness"
            label={t('panels:simulatorViewControls.axialStiffness', 'Stretch')}
            settings={settings}
            setSetting={setSetting}
          />
          <SettingSliderRow
            settingKey="creaseStiffness"
            label={t('panels:simulatorViewControls.creaseStiffness', 'Crease')}
            settings={settings}
            setSetting={setSetting}
          />
          <SettingSliderRow
            settingKey="panelStiffness"
            label={t('panels:simulatorViewControls.panelStiffness', 'Facet')}
            settings={settings}
            setSetting={setSetting}
          />
          <SettingSliderRow
            settingKey="faceStiffness"
            label={t('panels:simulatorViewControls.faceStiffness', 'Face')}
            settings={settings}
            setSetting={setSetting}
          />
          <SettingSliderRow
            settingKey="damping"
            label={t('panels:simulatorViewControls.damping', 'Damping')}
            settings={settings}
            setSetting={setSetting}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={t('panels:simulatorViewControls.solver', 'Solver')}
          collapsible
          description={t(
            'panels:simulatorViewControls.solverHint',
            'Lower stability if a fold jitters or blows up.'
          )}
        >
          <SettingSliderRow
            settingKey="timeStepScale"
            label={t('panels:simulatorViewControls.stability', 'Stability')}
            settings={settings}
            setSetting={setSetting}
            // Shown inverted: a smaller timestep is *more* stable, and a slider
            // labelled "stability" that decreases as you drag right would read
            // backwards.
            invert
          />
          <SettingSliderRow
            settingKey="foldPlayPercentPerSecond"
            label={t('panels:simulatorViewControls.playSpeed', 'Play speed')}
            settings={settings}
            setSetting={setSetting}
          />
        </CollapsibleSection>
      </div>
    </section>
  );
}

/** A simulator setting as a row: range and step from the settings table. */
function SettingSliderRow({
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
    <SliderRow
      label={label}
      min={range.min}
      max={range.max}
      step={range.step}
      value={shown}
      format={() => formatSettingValue(value, range.step)}
      onChange={(next) => setSetting(settingKey, invert ? range.min + range.max - next : next)}
    />
  );
}

/** Show as many decimals as the step implies, so a 0.05 step does not read "0.7000000001". */
function formatSettingValue(value: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return value.toFixed(decimals);
}
