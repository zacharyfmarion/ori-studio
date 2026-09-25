/**
 * Settings ▸ Paper: the app-wide paper style, one slot at a time.
 *
 * Two slots — what the screen draws with and what an export draws with — and
 * the export slot follows display until the user detaches it, at which point
 * it becomes its own copy; while it follows, the fields below are showing
 * display's style and are taken out of the page rather than merely greyed.
 * Presets are whole styles, each a picture of itself: the built-ins, and the
 * user's own as `.json` files they can pass around. Below them, every field of
 * the slot: the two paper colours, a card per pen in the two groups the
 * surfaces make of them, and what folding does — the creases already in the
 * paper, erode and the light. Last, the page every export is painted onto,
 * which is not a style and not part of the slot: the same picture goes out on
 * any page.
 *
 * Composition only. Each section owns its own markup and its own state next to
 * it; what lives here is the order they come in and which of them the slot
 * governs.
 */
import { useTranslation } from 'react-i18next';
import { paperPenLabel } from '../../i18n/enumLabels';
import { getPaperStyleField, type PaperStyleField } from '../../lib/paper/paperStyle';
import { ColorField } from '../ui/ColorField';
import { PaperFoldedCard } from './PaperFoldedCard';
import { PaperPenCard } from './PaperPenCard';
import { PaperPresetsSection } from './PaperPresetsSection';
import { PaperSection } from './PaperSection';
import { PaperLinkBanner, PaperSlotHeader } from './PaperSlotHeader';
import {
  usePaperSettings,
  type PaperSettingsBinding,
  type PaperSettingsDeps,
} from './usePaperSettings';

export function PaperSettings({ deps }: { deps?: PaperSettingsDeps } = {}) {
  const { t } = useTranslation();
  const paper = usePaperSettings(deps);
  const { style, editable } = paper;

  return (
    <div className="settings-paper" data-testid="settings-paper">
      <PaperSlotHeader paper={paper} />
      {paper.slot === 'export' && <PaperLinkBanner paper={paper} />}

      <div className="settings-paper__groups">
        {/*
          Inert, not merely dim: while the export slot follows display the
          fields below are showing display's style, and a field that can be
          tabbed into and typed at would be writing to a style that does not
          exist yet. The controls are disabled too — this is the container that
          takes the whole block out of the page at once.
        */}
        <div className="settings-paper__style" inert={!editable}>
          <PaperPresetsSection paper={paper} />

          <PaperSection title={t('dialogs:settings.paper.paperTitle', 'Paper')}>
            <div className="settings-paper-swatches">
              <PaperColorCard
                label={t('dialogs:settings.paper.front', 'Front')}
                value={style.paper.front}
                disabled={!editable}
                onChange={(value) => paper.adjustField('paper.front', value)}
                onCommit={paper.endAdjustment}
              />
              <PaperColorCard
                label={t('dialogs:settings.paper.back', 'Back')}
                value={style.paper.back}
                disabled={!editable}
                onChange={(value) => paper.adjustField('paper.back', value)}
                onCommit={paper.endAdjustment}
              />
            </div>
          </PaperSection>

          {/*
            The pens, in the two groups the surfaces make of them: the lines a
            drawing is made of, and the arrows only a step diagram draws. One
            card each, because a pen is four decisions and a table row is one.
          */}
          <PaperSection
            title={t('dialogs:settings.paper.linesTitle', 'Lines')}
            hint={t('dialogs:settings.paper.pensHint', 'Simulations, folded figures, steps')}
          >
            <PenCards paper={paper} fields={LINE_PENS} />
          </PaperSection>

          <PaperSection
            title={t('dialogs:settings.paper.stepsTitle', 'Steps')}
            hint={t('dialogs:settings.paper.stepsHint', 'References only')}
          >
            <PenCards paper={paper} fields={STEP_PENS} />
          </PaperSection>

          <PaperSection
            title={t('dialogs:settings.paper.foldedPaperTitle', 'Folded paper')}
            hint={t('dialogs:settings.paper.lightHint', 'Simulator, folded figures')}
          >
            <PaperFoldedCard paper={paper} />
          </PaperSection>
        </div>
      </div>
    </div>
  );
}

type PenField = Extract<
  PaperStyleField,
  'edges' | 'mountainFolds' | 'valleyFolds' | 'auxCreases.pen' | 'arrows'
>;

/** The pens every drawing is made of: the sheet's own edges, the folds, the creases already in it. */
const LINE_PENS: readonly PenField[] = ['edges', 'mountainFolds', 'valleyFolds', 'auxCreases.pen'];
/** The pens only a step diagram uses. */
const STEP_PENS: readonly PenField[] = ['arrows'];

/** One paper colour, on a card of its own. */
function PaperColorCard({
  label,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="settings-paper__card settings-paper__card--color">
      <ColorField
        layout="inline"
        showValue
        label={label}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

/** A group's pens, each on its own card, two across. */
function PenCards({
  paper,
  fields,
}: {
  paper: PaperSettingsBinding;
  fields: readonly PenField[];
}) {
  const { t } = useTranslation();
  return (
    <div className="settings-paper-pens">
      {fields.map((field) => (
        <PaperPenCard
          key={field}
          label={paperPenLabel(t, field)}
          pen={getPaperStyleField(paper.style, field)}
          paper={paper.style.paper}
          disabled={!paper.editable}
          onAdjust={(pen) => paper.adjustField(field, pen)}
          onSet={(pen) => paper.setField(field, pen)}
          onCommit={paper.endAdjustment}
        />
      ))}
    </div>
  );
}
