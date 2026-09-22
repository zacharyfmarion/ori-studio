import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload } from 'lucide-react';
import { paperPenLabel, paperPresetLabel, penCapLabel } from '../../i18n/enumLabels';
import { formatDashText, parseDashText } from '../../lib/paper/paperDashText';
import {
  getPaperStyleField,
  PEN_WIDTH_RANGE,
  type PaperStyleField,
  type Pen,
  type PenCap,
} from '../../lib/paper/paperStyle';
import type { PaperStyleSlot } from '../../lib/paperStyleSettings';
import { Button } from '../ui/Button';
import { ColorField } from '../ui/ColorField';
import { NumberField } from '../ui/NumberField';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { SettingsToggleRow } from './SettingsToggleRow';
import { usePaperSettings, type PaperPresetRow, type PaperSettingsDeps } from './usePaperSettings';

/**
 * Settings ▸ Paper: the app-wide paper style, one slot at a time.
 *
 * Two slots — what the screen draws with and what an export draws with — and
 * the export slot follows display until the user says otherwise, at which
 * point it becomes its own copy. Presets are whole styles: the built-ins, and
 * the user's own as `.json` files they can pass around. Below them, every
 * field of the slot: the two paper colours, one row per pen, the aux-crease
 * toggle and the light.
 */
export function PaperSettings({ deps }: { deps?: PaperSettingsDeps } = {}) {
  const { t } = useTranslation();
  const paper = usePaperSettings(deps);
  const { style, editable } = paper;
  const penFields: PenField[] = ['edges', 'mountainFolds', 'valleyFolds', 'auxCreases.pen', 'arrows'];

  return (
    <div className="settings-tab" data-testid="settings-paper">
      <section className="settings-section">
        <h3 className="settings-section__title">{t('dialogs:settings.paper.slot.title', 'Style')}</h3>
        <SegmentedControl<PaperStyleSlot>
          aria-label={t('dialogs:settings.paper.slot.title', 'Style')}
          value={paper.slot}
          onChange={paper.setSlot}
          options={[
            { value: 'display', label: t('dialogs:settings.paper.slot.display', 'Display') },
            { value: 'export', label: t('dialogs:settings.paper.slot.export', 'Export') },
          ]}
        />
        <SettingsToggleRow
          label={t('dialogs:settings.paper.exportFollowsDisplay', 'Export uses display style')}
          description={t(
            'dialogs:settings.paper.exportFollowsDisplayHint',
            'Off, the export style starts as a copy of the display style and is edited on its own.'
          )}
          checked={paper.exportFollowsDisplay}
          onChange={paper.setExportFollowsDisplay}
        />
      </section>

      <PresetsSection paper={paper} />

      <section className="settings-section">
        <h3 className="settings-section__title">{t('dialogs:settings.paper.paperTitle', 'Paper')}</h3>
        <div className="settings-paper-swatches">
          <ColorField
            layout="inline"
            label={t('dialogs:settings.paper.front', 'Front')}
            value={style.paper.front}
            disabled={!editable}
            onChange={(value) => paper.adjustField('paper.front', value)}
            onCommit={paper.endAdjustment}
          />
          <ColorField
            layout="inline"
            label={t('dialogs:settings.paper.back', 'Back')}
            value={style.paper.back}
            disabled={!editable}
            onChange={(value) => paper.adjustField('paper.back', value)}
            onCommit={paper.endAdjustment}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">{t('dialogs:settings.paper.pensTitle', 'Pens')}</h3>
        <div className="settings-paper-pens">
          <div className="settings-paper-pen settings-paper-pen--head" aria-hidden="true">
            <span />
            <span />
            <span>{t('dialogs:settings.paper.penWidth', 'Width (pt)')}</span>
            <span>{t('dialogs:settings.paper.penDash', 'Dash')}</span>
            <span>{t('dialogs:settings.paper.penCap', 'Cap')}</span>
          </div>
          {penFields.map((field) => (
            <PenRow
              key={field}
              label={paperPenLabel(t, field)}
              pen={getPaperStyleField(style, field)}
              disabled={!editable}
              onAdjust={(pen) => paper.adjustField(field, pen)}
              onSet={(pen) => paper.setField(field, pen)}
              onCommit={paper.endAdjustment}
            />
          ))}
        </div>
        <SettingsToggleRow
          label={t('dialogs:settings.paper.auxVisible', 'Show existing creases on folded paper')}
          checked={style.auxCreases.visible}
          disabled={!editable}
          onChange={(visible) => paper.setField('auxCreases.visible', visible)}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-section__title">{t('dialogs:settings.paper.lightTitle', 'Light')}</h3>
        <SettingsToggleRow
          label={t('dialogs:settings.paper.lightEnabled', 'Shade folded paper by a directional light')}
          checked={style.light.enabled}
          disabled={!editable}
          onChange={(enabled) => paper.setField('light', { ...style.light, enabled })}
        />
        <FieldRow label={t('dialogs:settings.paper.lightAzimuth', 'Azimuth')} description={t('dialogs:settings.paper.lightAzimuthHint', 'Degrees clockwise from straight up.')}>
          {(id, label) => (
            <NumberField
              id={id}
              label={label}
              value={style.light.azimuth}
              min={0}
              max={360}
              step={1}
              suffix="°"
              disabled={!editable}
              onCommit={(azimuth) => paper.setField('light', { ...style.light, azimuth })}
            />
          )}
        </FieldRow>
        <FieldRow label={t('dialogs:settings.paper.lightElevation', 'Elevation')} description={t('dialogs:settings.paper.lightElevationHint', 'Degrees out of the screen; 90 is straight at the paper.')}>
          {(id, label) => (
            <NumberField
              id={id}
              label={label}
              value={style.light.elevation}
              min={-90}
              max={90}
              step={1}
              suffix="°"
              disabled={!editable}
              onCommit={(elevation) => paper.setField('light', { ...style.light, elevation })}
            />
          )}
        </FieldRow>
      </section>
    </div>
  );
}

type PenField = Extract<
  PaperStyleField,
  'edges' | 'mountainFolds' | 'valleyFolds' | 'auxCreases.pen' | 'arrows'
>;

/**
 * The preset list and its verbs. "Save current as…" opens a name field in
 * place rather than a command dialog: the Settings modal takes Escape on
 * `window` ahead of any dialog opened from inside it, so a prompt would need
 * the nested-dialog handshake for one text field.
 */
function PresetsSection({ paper }: { paper: ReturnType<typeof usePaperSettings> }) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const nameId = useId();
  const trimmed = name.trim();

  const save = () => {
    if (!trimmed) return;
    paper.savePreset(trimmed);
    setNaming(false);
    setName('');
  };

  return (
    <section className="settings-section" data-testid="settings-paper-presets">
      <h3 className="settings-section__title">{t('dialogs:settings.paper.presets.title', 'Presets')}</h3>
      {paper.presets.map((row) => (
        <PresetRow key={row.key} row={row} paper={paper} />
      ))}
      {naming ? (
        <form
          className="settings-paper-name"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="settings-toggle-row__label" htmlFor={nameId}>
            {t('dialogs:settings.paper.presets.name', 'Preset name')}
          </label>
          <input
            id={nameId}
            className="control-row__input"
            type="text"
            value={name}
            autoFocus
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Button size="sm" variant="primary" type="submit" disabled={!trimmed}>
            {t('dialogs:settings.paper.presets.save', 'Save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            {t('dialogs:common.cancel', 'Cancel')}
          </Button>
        </form>
      ) : (
        <div className="settings-paper-actions">
          <Button size="sm" variant="secondary" onClick={() => setNaming(true)}>
            {t('dialogs:settings.paper.presets.saveAs', 'Save current as…')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void paper.importPreset()}>
            <Upload size={14} aria-hidden="true" />
            {t('dialogs:settings.paper.presets.import', 'Import…')}
          </Button>
        </div>
      )}
    </section>
  );
}

function PresetRow({ row, paper }: { row: PaperPresetRow; paper: ReturnType<typeof usePaperSettings> }) {
  const { t } = useTranslation();
  const label = row.builtIn ? paperPresetLabel(t, row.builtIn) : row.preset.name;
  const description = row.builtIn
    ? t('dialogs:settings.paper.presets.builtIn', 'Built in')
    : row.preset.author
      ? t('dialogs:settings.paper.presets.by', 'By {{author}}', { author: row.preset.author })
      : t('dialogs:settings.paper.presets.yours', 'Saved by you');
  return (
    <div className="settings-toggle-row settings-toggle-row--action" data-testid={`settings-paper-preset-${row.key}`}>
      <div className="settings-toggle-row__copy">
        <span className="settings-toggle-row__label">{label}</span>
        <span className="settings-toggle-row__desc">{description}</span>
      </div>
      <div className="settings-paper-actions">
        <Button size="sm" variant="primary" disabled={!paper.editable} onClick={() => paper.applyPreset(row)}>
          {t('dialogs:settings.paper.presets.apply', 'Apply')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-label={t('dialogs:settings.paper.presets.exportNamed', 'Export {{name}}', { name: label })}
          title={t('dialogs:settings.paper.presets.export', 'Export')}
          onClick={() => void paper.exportPreset(row)}
        >
          <Download size={14} aria-hidden="true" />
        </Button>
        {!row.builtIn && (
          <Button size="sm" variant="ghost" onClick={() => paper.removePreset(row.preset.name)}>
            {t('dialogs:settings.paper.presets.delete', 'Delete')}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One pen: swatch, width in pt, dash as space-separated multiples of the
 * width, cap. The colour is continuous (the picker fires per move) and is
 * committed on blur; the other three are discrete.
 */
function PenRow({
  label,
  pen,
  disabled,
  onAdjust,
  onSet,
  onCommit,
}: {
  label: string;
  pen: Pen;
  disabled: boolean;
  onAdjust: (pen: Pen) => void;
  onSet: (pen: Pen) => void;
  onCommit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="settings-paper-pen" data-testid={`settings-paper-pen-${label}`}>
      <span className="settings-toggle-row__label">{label}</span>
      <ColorField
        layout="inline"
        label={t('dialogs:settings.paper.penColorNamed', '{{pen}} color', { pen: label })}
        value={pen.color}
        disabled={disabled}
        onChange={(color) => onAdjust({ ...pen, color })}
        onCommit={onCommit}
        className="settings-paper-pen__color"
      />
      <NumberField
        label={t('dialogs:settings.paper.penWidthNamed', '{{pen}} width', { pen: label })}
        value={pen.width}
        min={PEN_WIDTH_RANGE.min}
        max={PEN_WIDTH_RANGE.max}
        step={PEN_WIDTH_RANGE.step}
        steppers={false}
        disabled={disabled}
        onCommit={(width) => onSet({ ...pen, width })}
      />
      <DashField
        label={t('dialogs:settings.paper.penDashNamed', '{{pen}} dash', { pen: label })}
        value={pen.dash}
        disabled={disabled}
        onCommit={(dash) => onSet({ ...pen, dash })}
      />
      <Select value={pen.cap} onValueChange={(cap) => onSet({ ...pen, cap: cap as PenCap })} disabled={disabled}>
        <SelectTrigger aria-label={t('dialogs:settings.paper.penCapNamed', '{{pen}} cap', { pen: label })}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(['butt', 'round'] as const).map((cap) => (
            <SelectItem key={cap} value={cap}>
              {penCapLabel(t, cap)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A dash as text, committed on blur or Enter. A draft that does not parse is
 * put back to the pen's dash rather than written: a half-typed `8 2 1` is a
 * different dash, and an `8 x` is none.
 */
function DashField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number[] | null;
  disabled: boolean;
  onCommit: (dash: number[] | null) => void;
}) {
  const [draft, setDraft] = useState(() => formatDashText(value));
  useEffect(() => {
    setDraft(formatDashText(value));
  }, [value]);

  const commit = () => {
    const parsed = parseDashText(draft);
    if (parsed === undefined) {
      setDraft(formatDashText(value));
      return;
    }
    setDraft(formatDashText(parsed));
    if (formatDashText(parsed) !== formatDashText(value)) onCommit(parsed);
  };

  return (
    <input
      className="control-row__input settings-paper-pen__dash"
      type="text"
      aria-label={label}
      placeholder="8 2 1 2"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/** The modal's field row — copy left, control right — for a number that needs a line of explanation. */
function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: (id: string, label: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="settings-toggle-row settings-toggle-row--field">
      <span className="settings-toggle-row__copy">
        <label className="settings-toggle-row__label" htmlFor={id}>
          {label}
        </label>
        <span className="settings-toggle-row__desc">{description}</span>
      </span>
      <span className="settings-toggle-row__field">{children(id, label)}</span>
    </div>
  );
}
