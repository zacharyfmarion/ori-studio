import { useTranslation } from 'react-i18next';
import { Axis3d, Download, RotateCcw } from 'lucide-react';
import { runSimulatorCommand } from '../../keyboard/shortcutRuntime';
import {
  SIMULATOR_SETTING_RANGES,
  type SimulatorNumericSettingKey,
  type SimulatorSettings,
} from '../../lib/simulatorSettings';
import { simulatorColorModeLabel } from '../../i18n/enumLabels';
import {
  useSimulatorPaperStyle,
  type SimulatorPenField,
} from '../../simulator/useSimulatorPaperStyle';
import { useSimulationInHand } from '../../simulator/useSimulatorShortcuts';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { ColorField } from '../ui/ColorField';
import { SelectRow, SliderRow, ToggleRow } from '../ui/fieldRows';
import { ViewControlsAction, ViewControlsActions } from './ViewControlsActions';

/**
 * Options pane for the Simulate workspace, mirroring the Edit workspace's view
 * pane. Render options are applied by the simulator panel; material and solver
 * options go to the engine live (both backends recompute their timestep on a
 * material change), so nothing here reloads the model.
 *
 * It leads with the two things done *to* the view rather than configured for
 * it — export it, and set which way is up. Both act on the viewport, which is
 * the simulator panel's, so each runs that panel's own verb
 * (`simulator.exportView`, `simulator.setUpright`) through its executor. The
 * panel registers one only while its simulation is ready, so whether one is
 * registered is also what enables them.
 */
export function SimulatorViewControlsPanel() {
  const { t } = useTranslation();
  const settings = useWorkspaceStore((state) => state.simulatorSettings);
  const setSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  const resetMaterial = useWorkspaceStore((state) => state.resetSimulatorMaterial);
  const ready = useSimulationInHand();
  // How the paper is drawn is the app-wide paper style, not a simulator
  // setting; these rows are its simulator-facing subset.
  const paper = useSimulatorPaperStyle();
  // The page an export is painted onto is the export dialog's alone (X7).
  // Folds drawn as edges take the paper edge's colour, so the per-kind
  // swatches stop doing anything; showing them live would promise an effect
  // they no longer have.
  const asEdges = paper.style.foldsAsEdges;
  const penRow = (pen: SimulatorPenField, label: string, disabled = false) => (
    <ColorField
      label={label}
      layout="row"
      value={paper.style[pen].color}
      disabled={disabled}
      onChange={(value) => paper.setPenColor(pen, value)}
      onCommit={paper.endAdjustment}
    />
  );

  return (
    <section className="panel-shell simulator-view-controls-panel">
      <ViewControlsActions>
        <ViewControlsAction
          icon={<Download size={14} aria-hidden="true" />}
          label={t('panels:simulatorExport.trigger', 'Export view…')}
          disabled={!ready}
          onClick={() => runSimulatorCommand('simulator.exportView')}
        />
        {/*
          Which way the model is up. The orbit is a turntable about the paper's
          *normal*, which is up for a flat sheet and is not for a model that
          stands — so a standing figure tumbles rather than turning, and dragging
          cannot fix it because yaw and pitch only move the eye on a sphere whose
          pole is fixed. This picks the pole.

          No matching "clear": the way back is the view reset (0 / Home, or
          double-click the canvas), which drops the orientation with the angles.
          See `SimulatorViewport.resetView`.
        */}
        <ViewControlsAction
          icon={<Axis3d size={14} aria-hidden="true" />}
          label={t('panels:simulator.setUpright', 'Set upright')}
          disabled={!ready}
          onClick={() => runSimulatorCommand('simulator.setUpright')}
        />
      </ViewControlsActions>
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
            label={t('panels:simulatorViewControls.lighting', 'Lighting')}
            checked={paper.style.light.enabled}
            onChange={paper.setLighting}
          />
          <ToggleRow
            label={t('panels:simulatorViewControls.viewCube', 'View cube')}
            checked={settings.showViewCube}
            onChange={(checked) => setSetting('showViewCube', checked)}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title={t('panels:simulatorViewControls.paper', 'Paper')}
          collapsible
          action={
            <button
              type="button"
              className="collapsible-section__action"
              title={t('panels:simulatorViewControls.resetStyle', 'Reset style')}
              aria-label={t('panels:simulatorViewControls.resetStyle', 'Reset style')}
              onClick={paper.reset}
            >
              <RotateCcw size={12} />
            </button>
          }
        >
          <div className="simulator-view-controls-panel__colors">
            <ColorField
              label={t('panels:simulatorViewControls.paperFront', 'Front')}
              layout="row"
              value={paper.style.paper.front}
              onChange={(value) => paper.setPaperColor('paper.front', value)}
              onCommit={paper.endAdjustment}
            />
            <ColorField
              label={t('panels:simulatorViewControls.paperBack', 'Back')}
              layout="row"
              value={paper.style.paper.back}
              onChange={(value) => paper.setPaperColor('paper.back', value)}
              onCommit={paper.endAdjustment}
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection title={t('panels:simulatorViewControls.creases', 'Creases')} collapsible>
          <ToggleRow
            label={t('panels:simulatorViewControls.foldsAsEdges', 'Render all creases as edges')}
            help={t(
              'panels:simulatorViewControls.foldsAsEdgesHelp',
              'A fold that has happened is an edge of the paper: every fold is drawn in the paper edge’s color and dash, at the average of the mountain and valley widths. Off, folds are drawn by direction.'
            )}
            checked={asEdges}
            onChange={paper.setFoldsAsEdges}
          />
          <div className="simulator-view-controls-panel__colors">
            {penRow('mountainFolds', t('panels:simulatorViewControls.mountain', 'Mountain'), asEdges)}
            {penRow('valleyFolds', t('panels:simulatorViewControls.valley', 'Valley'), asEdges)}
            {penRow('edges', t('panels:simulatorViewControls.borderEdge', 'Edge'))}
          </div>
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
