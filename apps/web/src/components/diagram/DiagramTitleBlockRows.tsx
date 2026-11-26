import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { TITLE_BLOCK_ART_SIZE_DEFAULTS, TITLE_BLOCK_ART_SIZE_RANGE } from '../../diagram/document/diagramDocument';
import type { TitleBlockPartChoices } from '../../diagram/pages/titleBlockChoices';
import { useDiagramTitleBlock, type TitleBlockArtSize } from '../../diagram/pages/useDiagramTitleBlock';
import { SelectRow, SliderRow, TextAreaRow, ToggleRow, type SelectRowOption } from '../ui/fieldRows';
import { DiagramTitleBlockBandColorRow } from './DiagramTitleBlockBandColorRow';
import { DiagramTitleBlockCredits } from './DiagramTitleBlockCredits';

/** The crease pattern's last entry: not a choice but the way to one, opening a file picker. */
const UPLOAD_PATTERN = 'upload-file';

/** The sizes move by whole percents, so the defaults (59% and 79%) are stops. */
const SIZE_STEP = 1;
const SIZE_MIN = Math.round(TITLE_BLOCK_ART_SIZE_RANGE.min * 100);
const SIZE_MAX = Math.round(TITLE_BLOCK_ART_SIZE_RANGE.max * 100);

/**
 * The first page's title block, as rows the Page pane's Header & footer carries
 * under the diagram's title (`DiagramTitleRow`;
 * `implementation-plans/diagram-title-block.md`, Phase 1c, H-16 A): the
 * toggle and, a step in under it while the page has a block, what it shows —
 * top to bottom as the block reads: the subtitle, the band's colour
 * (`DiagramTitleBlockBandColorRow`), the credits and the description (the
 * file's `note`), then the finished model and the crease pattern, each Auto
 * (named by the step it finds), a step, or None — the pattern a file uploaded
 * for it too, by the menu's last entry — with its size while it is shown.
 * Bound by `useDiagramTitleBlock`, which offers only what the block can show.
 */
export function DiagramTitleBlockRows() {
  const { t, i18n } = useTranslation();
  const block = useDiagramTitleBlock();
  const { readOnly } = block;
  const step = (number: number) => t('panels:diagram.pagePane.titleBlock.step', 'Step {{number}}', { number });
  const auto = (number: number) => t('panels:diagram.pagePane.titleBlock.auto', 'Auto (step {{number}})', { number });
  const none = t('panels:diagram.pagePane.titleBlock.none', 'None');
  /** Auto, each step offered, `more` (the pattern's file), and None. */
  const options = (part: TitleBlockPartChoices, autoNone: string, more: SelectRowOption[] = []): SelectRowOption[] => [
    { id: 'auto', label: part.autoNumber === null ? autoNone : auto(part.autoNumber) },
    ...part.steps.map((each) => ({ id: each.choice, label: step(each.number) })),
    ...more,
    { id: 'none', label: none },
  ];
  /** Why the step a part is set to shows nothing, as `cannot` says it for its number: on the row's note line, whole. */
  const reason = (part: TitleBlockPartChoices, cannot: (number: number) => string) => {
    const chosen = part.steps.find((each) => each.choice === part.value);
    return chosen && !chosen.gives ? cannot(chosen.number) : undefined;
  };
  /** The crease pattern's entries: its file by name while it is set to one, and last, the way to upload one. */
  const patternOptions = (part: TitleBlockPartChoices): SelectRowOption[] => [
    ...options(
      part,
      t('panels:diagram.pagePane.titleBlock.autoNoneLinked', 'Auto (none linked)'),
      part.file ? [{ id: 'upload', label: part.file.name }] : []
    ),
    { id: UPLOAD_PATTERN, label: t('panels:diagram.pagePane.titleBlock.uploadPattern', 'Upload a CP or FOLD file…') },
  ];
  const percent = (value: number) => new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(value / 100);
  /**
   * A size's slider, in percent of the block's height, handed over where it is let go: only as far as keeps the
   * model on the pattern's corner with the other size as it is.
   */
  const sizeRow = (key: TitleBlockArtSize, label: string, help: string) => {
    const max = Math.min(SIZE_MAX, Math.floor(block.sizeLimits[key] * 100 + 1e-9));
    return (
      <SliderRow
        label={label}
        help={help}
        nested
        value={Math.min(max, Math.round(block.sizes[key] * 100))}
        min={SIZE_MIN}
        max={max}
        step={SIZE_STEP}
        format={percent}
        valueText={percent}
        disabled={readOnly}
        onCommit={(value) => block.setSize(key, value / 100)}
        onReset={block.sizes[key] !== TITLE_BLOCK_ART_SIZE_DEFAULTS[key] ? () => block.setSize(key, 'default') : undefined}
      />
    );
  };
  return (
    <>
      <ToggleRow
        label={t('panels:diagram.pagePane.titleBlock.show', 'Title block')}
        help={t(
          'panels:diagram.pagePane.titleBlock.showHelp',
          'The title and its credits, the crease pattern and the finished model, at the top of the first page.'
        )}
        note={block.fits ? undefined : t('panels:diagram.pagePane.titleBlock.needsRows', 'Needs two rows or more')}
        checked={block.shown}
        disabled={readOnly || !block.fits}
        onChange={block.setEnabled}
      />
      {block.shown && (
        // One set of fields per diagram: a draft never carries over to the one that replaces it.
        <Fragment key={block.loadId}>
          <TextAreaRow
            label={t('panels:diagram.pagePane.titleBlock.subtitle', 'Subtitle')}
            help={t(
              'panels:diagram.pagePane.titleBlock.subtitleHelp',
              'The small line over the title. Clear it to print none.'
            )}
            nested
            value={block.subtitle}
            rows={1}
            singleLine
            disabled={readOnly}
            onCommit={block.setSubtitle}
          />
          <DiagramTitleBlockBandColorRow />
          <DiagramTitleBlockCredits
            credits={block.credits}
            stepCount={block.stepCount}
            hasStepCount={block.hasStepCount}
            disabled={readOnly}
            nested
            onAdd={block.addCredit}
            onAddStepCount={block.addStepCount}
            onRemove={block.removeCredit}
            onLabel={block.setCreditLabel}
            onValue={block.setCreditValue}
            onTypeValue={block.typeCreditValue}
          />
          {/* The description: the file's `note`, named for the author as Zach asked (2026-10-15). */}
          <TextAreaRow
            label={t('panels:diagram.pagePane.titleBlock.description', 'Description')}
            help={t(
              'panels:diagram.pagePane.titleBlock.descriptionHelp',
              'Free text under the credits. It prints only when it has text.'
            )}
            nested
            value={block.note}
            rows={3}
            disabled={readOnly}
            onCommit={block.setNote}
          />
          <SelectRow
            label={t('panels:diagram.pagePane.titleBlock.model', 'Model')}
            help={t(
              'panels:diagram.pagePane.titleBlock.modelHelp',
              'The finished model, drawn from a step’s picture. Auto uses the last step with one.'
            )}
            note={reason(block.model, (number) =>
              t('panels:diagram.pages.titleBlock.stepNoPicture', 'Step {{number}} has no picture yet', { number })
            )}
            nested
            value={block.model.value}
            disabled={readOnly}
            options={options(block.model, t('panels:diagram.pagePane.titleBlock.autoNoPicture', 'Auto (no pictures)'))}
            onChange={block.setModel}
          />
          {block.model.value !== 'none' &&
            sizeRow(
              'modelSize',
              t('panels:diagram.pagePane.titleBlock.modelSize', 'Model size'),
              t('panels:diagram.pagePane.titleBlock.modelSizeHelp', 'The model’s height, as a share of the title block’s.')
            )}
          <SelectRow
            label={t('panels:diagram.pagePane.titleBlock.pattern', 'Crease pattern')}
            help={t(
              'panels:diagram.pagePane.titleBlock.patternHelp',
              'Its mountain and valley folds, from the crease pattern a step links or from a file you upload. Auto uses the last linked step; each pattern is listed once, by the step chosen for it or else the last step that links it.'
            )}
            note={
              block.pattern.file && !block.pattern.file.gives
                ? t('panels:diagram.pages.titleBlock.fileNoPattern', 'The uploaded file has no folds')
                : reason(block.pattern, (number) =>
                    t('panels:diagram.pages.titleBlock.stepNoPattern', 'Step {{number}} has no crease pattern', { number })
                  )
            }
            nested
            value={block.pattern.value}
            disabled={readOnly}
            options={patternOptions(block.pattern)}
            // The upload entry opens the picker inside this very event: a browser allows one only from a gesture.
            onChange={(choice) => (choice === UPLOAD_PATTERN ? block.uploadPattern() : block.setPattern(choice))}
          />
          {block.pattern.value !== 'none' &&
            sizeRow(
              'patternSize',
              t('panels:diagram.pagePane.titleBlock.patternSize', 'Crease pattern size'),
              t(
                'panels:diagram.pagePane.titleBlock.patternSizeHelp',
                'The crease pattern’s side, as a share of the title block’s height.'
              )
            )}
        </Fragment>
      )}
    </>
  );
}
