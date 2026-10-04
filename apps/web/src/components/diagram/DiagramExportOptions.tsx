import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FileText, Images, Printer, Scissors } from 'lucide-react';
import { STEP_FILE_DPIS, type DiagramExportSettings } from '../../diagram/export/diagramExportSettings';
import { PRINT_SHOP_BLEED_MM } from '../../diagram/export/diagramPdf';
import { STEP_FILE_MM_RANGE } from '../../diagram/export/stepFiles';
import type { DiagramExportBinding } from '../../diagram/export/useDiagramExport';
import type { DiagramPageSetup } from '../../diagram/document/diagramDocument';
import { pageSetupSummary } from '../../diagram/pages/pageSetupLabels';
import { Button } from '../ui/Button';
import { NumberRow, SegmentedRow, ToggleRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import { OptionCards } from '../ui/OptionCard';
import styles from './DiagramExportOptions.module.css';

/** At most this many step numbers are named in a sentence; the rest are counted. */
const NAMED_STEPS = 8;

/** "4, 5 and 9", or "4, 5, 6, … and 12 more": the steps a Notice sentence is about. */
export function formatStepNumbers(numbers: readonly number[], language: string, t: TFunction): string {
  const named = numbers.slice(0, NAMED_STEPS).map(String);
  const more = numbers.length - named.length;
  if (more > 0) {
    named.push(t('dialogs:diagramExport.moreSteps', '{{count}} more', { count: more, defaultValue_one: '{{count}} more' }));
  }
  return new Intl.ListFormat(language, { type: 'conjunction' }).format(named);
}

/**
 * The export dialog's options (D11): a PDF of the pages, to print at home or
 * at a print shop, or a file for each step, and how those are made; then a
 * Notice of what the export will leave out or cut. Presentation over the
 * dialog's draft (`useDiagramExport`): every control patches the draft and
 * nothing else.
 */
export function DiagramExportOptions({
  binding,
  page,
  onEditPageSetup,
}: {
  binding: DiagramExportBinding;
  /** The pages' setup, summed up beside Edit. */
  page: DiagramPageSetup;
  /** Close the dialog for the pages and the Page tab: their size, layout and style are set there. */
  onEditPageSetup: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { draft, patch } = binding;
  const pdf = draft.kind === 'pdf';
  const steps = (numbers: readonly number[]) => formatStepNumbers(numbers, i18n.language, t);

  return (
    <>
      <section className={styles.section}>
        <OptionCards<DiagramExportSettings['kind']>
          label={t('dialogs:diagramExport.kind', 'Export as')}
          value={draft.kind}
          onChange={(kind) => patch({ kind })}
          options={[
            {
              value: 'pdf',
              label: t('dialogs:diagramExport.pdf', 'PDF'),
              description: t('dialogs:diagramExport.pdfHint', 'Every page, ready to print.'),
              icon: <FileText size={16} />,
            },
            {
              value: 'steps',
              label: t('dialogs:diagramExport.steps', 'Step files (ZIP)'),
              description: t('dialogs:diagramExport.stepsHint', 'A picture of each step, for a layout of your own.'),
              icon: <Images size={16} />,
            },
          ]}
        />
      </section>

      {pdf ? (
        <section className={styles.section}>
          <OptionCards<DiagramExportSettings['pdf']>
            label={t('dialogs:diagramExport.printFor', 'Print')}
            value={draft.pdf}
            onChange={(mode) => patch({ pdf: mode })}
            options={[
              {
                value: 'home',
                label: t('dialogs:diagramExport.home', 'At home'),
                description: t('dialogs:diagramExport.homeHint', 'Each page on its own sheet.'),
                icon: <Printer size={16} />,
              },
              {
                value: 'print-shop',
                label: t('dialogs:diagramExport.printShop', 'Print shop'),
                description: t(
                  'dialogs:diagramExport.printShopHint',
                  '{{bleed}} mm bleed, trim box and crop marks.',
                  { bleed: PRINT_SHOP_BLEED_MM }
                ),
                icon: <Scissors size={16} />,
              },
            ]}
          />
          <div className={styles.pageSetup}>
            <span className={styles.setup}>
              <span className={styles.setupLabel}>{t('dialogs:diagramExport.pageSetup', 'Page setup')}</span>
              <span>{pageSetupSummary(page, t)}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={onEditPageSetup}>
              {t('dialogs:diagramExport.editPageSetup', 'Edit page setup')}
            </Button>
          </div>
        </section>
      ) : (
        <section className={styles.section}>
          <SegmentedRow
            label={t('dialogs:diagramExport.format', 'Format')}
            help={t(
              'dialogs:diagramExport.formatHelp',
              'SVG stays sharp at any size and opens in most drawing and layout apps. PNG is a picture at the resolution below.'
            )}
            value={draft.format}
            onChange={(format) => patch({ format: format === 'png' ? 'png' : 'svg' })}
            options={[
              { id: 'svg', label: 'SVG' },
              { id: 'png', label: 'PNG' },
            ]}
          />
          {draft.format === 'png' && (
            <SegmentedRow
              label={t('dialogs:diagramExport.resolution', 'Resolution')}
              value={String(draft.dpi)}
              onChange={(dpi) => patch({ dpi: dpi === '600' ? 600 : 300 })}
              options={STEP_FILE_DPIS.map((dpi) => ({
                id: String(dpi),
                label: t('dialogs:diagramExport.dpi', '{{dpi}} dpi', { dpi }),
              }))}
            />
          )}
          <ToggleRow
            label={t('dialogs:diagramExport.number', 'Step number')}
            help={t('dialogs:diagramExport.numberHelp', 'Draws the step’s number into its file.')}
            checked={draft.number}
            onChange={(number) => patch({ number })}
          />
          <ToggleRow
            label={t('dialogs:diagramExport.text', 'Instruction')}
            help={t('dialogs:diagramExport.textHelp', 'Leave it off to set the text in your own layout app.')}
            checked={draft.text}
            onChange={(text) => patch({ text })}
          />
          <ToggleRow
            label={t('dialogs:diagramExport.sameSize', 'Same size for every step')}
            help={t(
              'dialogs:diagramExport.sameSizeHelp',
              'Every file is the size below, so the steps line up. Off, each file is cut to its drawing. Either way every step is drawn at one scale.'
            )}
            checked={draft.sameSize}
            onChange={(sameSize) => patch({ sameSize })}
          />
          <NumberRow
            label={t('dialogs:diagramExport.width', 'Width')}
            value={draft.widthMm}
            min={STEP_FILE_MM_RANGE.min}
            max={STEP_FILE_MM_RANGE.max}
            step={STEP_FILE_MM_RANGE.step}
            suffix="mm"
            onCommit={(widthMm) => patch({ widthMm })}
          />
          <NumberRow
            label={t('dialogs:diagramExport.height', 'Height')}
            value={draft.heightMm}
            min={binding.minHeightMm}
            max={STEP_FILE_MM_RANGE.max}
            step={STEP_FILE_MM_RANGE.step}
            suffix="mm"
            onCommit={(heightMm) => patch({ heightMm })}
          />
          <ToggleRow
            label={t('dialogs:diagramExport.transparent', 'Transparent background')}
            checked={draft.transparent}
            onChange={(transparent) => patch({ transparent })}
          />
        </section>
      )}

      {(binding.empty.length > 0 ||
        binding.cut.length > 0 ||
        binding.missing.length > 0 ||
        binding.unavailable ||
        (!pdf && binding.turns > 0)) && (
        <Notice tone={(pdf && binding.missing.length > 0) || binding.unavailable ? 'warning' : 'info'}>
          <ul className={styles.notes}>
            {binding.unavailable && (
              <li className={styles.retry}>
                <span>
                  {t(
                    'dialogs:diagramExport.fontsUnavailable',
                    'Some of the diagram’s fonts couldn’t be downloaded, so some of its characters can’t be set. Check your connection, then try again.'
                  )}
                </span>
                <Button size="sm" variant="secondary" onClick={binding.retry}>
                  {t('dialogs:diagramExport.retry', 'Try again')}
                </Button>
              </li>
            )}
            {binding.missing.length > 0 && !binding.unavailable && (
              <li>
                {pdf
                  ? t(
                      'dialogs:diagramExport.missingPdf',
                      'The diagram’s fonts have no {{characters}}, so a PDF can’t be made. Change the text, or export step files.',
                      { characters: binding.missing.join(' ') }
                    )
                  : t(
                      'dialogs:diagramExport.missingFiles',
                      'The diagram’s fonts have no {{characters}}: the files draw a box for each.',
                      { characters: binding.missing.join(' ') }
                    )}
              </li>
            )}
            {binding.empty.length > 0 && <li>{emptySentence(t, pdf, steps(binding.empty), binding.empty.length)}</li>}
            {binding.cut.length > 0 && (
              <li>{cutSentence(t, steps(binding.cut), binding.cut.length)}</li>
            )}
            {!pdf && binding.turns > 0 && (
              <li>
                {t('dialogs:diagramExport.turnsLeftOut', {
                  count: binding.turns,
                  defaultValue_one: 'The turn between steps prints on the pages; the step files leave it out.',
                  defaultValue_other: 'The {{count}} turns between steps print on the pages; the step files leave them out.',
                })}
              </li>
            )}
          </ul>
        </Notice>
      )}
    </>
  );
}

/**
 * The sentence about the steps with no picture: about one step, or about
 * several, chosen by how many — not by the plural form of the count, which in
 * Russian is "one" for 21 and 101 too.
 */
function emptySentence(t: TFunction, pdf: boolean, steps: string, count: number): string {
  if (pdf) {
    return count === 1
      ? t('dialogs:diagramExport.emptyPdfStep', 'Step {{steps}} has no picture and will print as blank space.', { steps })
      : t('dialogs:diagramExport.emptyPdfSteps', 'Steps {{steps}} have no picture and will print as blank space.', {
          steps,
        });
  }
  return count === 1
    ? t('dialogs:diagramExport.emptyFilesStep', 'Step {{steps}} has no picture and will be skipped.', { steps })
    : t('dialogs:diagramExport.emptyFilesSteps', 'Steps {{steps}} have no picture and will be skipped.', { steps });
}

/** The sentence about the instructions cut, chosen as {@link emptySentence}'s is. */
function cutSentence(t: TFunction, steps: string, count: number): string {
  return count === 1
    ? t('dialogs:diagramExport.cutStep', 'The instruction of step {{steps}} doesn’t fit and is cut.', { steps })
    : t('dialogs:diagramExport.cutSteps', 'The instructions of steps {{steps}} don’t fit and are cut.', { steps });
}
