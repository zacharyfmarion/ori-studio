/**
 * Fold-angle control for the CP context panel.
 *
 * Selection-scoped, not tool-scoped: the active tool has no bearing on whether
 * you can set a fold angle, so this renders outside the panel's tool-setting
 * groups and self-hides when nothing foldable is selected.
 *
 * Applying to a selection is the workhorse for the transcription workflow —
 * draw everything classic, then select and assign — because you learn the angles
 * by folding, not while drawing.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '../../components/ui/Chip';
import { FOLD_ANGLE_PRESETS, describeAffected } from './foldAngleActions';
import { useFoldAngleSelection } from './useFoldAngleSelection';

export function FoldAngleControl() {
  const { t } = useTranslation();
  const { summary, enabled, setDegrees, setUnassigned } = useFoldAngleSelection();
  const [draft, setDraft] = useState('');

  // Follow the selection, but leave a mixed selection blank rather than
  // inventing a value for it.
  useEffect(() => {
    setDraft(summary.degrees === null ? '' : String(summary.degrees));
  }, [summary.degrees]);

  if (!enabled) return null;

  const commitDraft = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 180) {
      setDraft(summary.degrees === null ? '' : String(summary.degrees));
      return;
    }
    void setDegrees(parsed);
  };

  return (
    <div className="cp-context-panel__group">
      <div className="cp-context-panel__group-title">
        {t('tools:cpContext.foldAngle', 'Fold angle')}
      </div>
      <div className="cp-context-panel__chips">
        {FOLD_ANGLE_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            aria-label={preset.description}
            aria-pressed={summary.degrees === preset.degrees}
            onClick={() => void setDegrees(preset.degrees)}
          >
            {preset.label}
          </Chip>
        ))}
        {/* Beside the presets rather than below them, because it answers the
            same question they do — how far does this fold — with "I have not
            decided". It keeps the direction; forgetting that too is the menu's
            explicit ask.

            No `aria-pressed`: this is a verb that runs, not a choice that can be
            the current one, and saying `false` would announce a selection that
            is merely off. */}
        <Chip
          aria-label={t(
            'tools:cpContext.foldAngleUnassignedDescription',
            'Leave the fold angle undecided, keeping mountain or valley'
          )}
          onClick={() => void setUnassigned()}
        >
          {t('tools:cpContext.foldAngleUnassigned', 'Unassigned')}
        </Chip>
      </div>
      <label className="cp-context-panel__field">
        <span>{t('tools:cpContext.foldAngleDegrees', 'Degrees')}</span>
        <input
          type="number"
          min={0}
          max={180}
          step="any"
          value={draft}
          placeholder={summary.mixed ? t('tools:cpContext.foldAngleMixed', 'Mixed') : undefined}
          aria-label={t('tools:cpContext.foldAngleDegrees', 'Degrees')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitDraft();
          }}
        />
      </label>
      <div className="cp-context-panel__readout">{describeAffected(summary)}</div>
    </div>
  );
}
