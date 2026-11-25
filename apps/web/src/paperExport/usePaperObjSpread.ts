/**
 * The spread an OBJ is written with, as the export dialog holds it: the draft
 * Spread layers and Amount edit, opening on the figure's own spread, and the
 * fold it is previewed and written from (`PaperObjSpreadSource`), prepared the
 * first time OBJ is chosen — a reopened flat figure is folded again then, and
 * the spread solved, flat or in 3D.
 *
 * Like every option of the dialog it is a draft: closing the dialog changes
 * nothing of the figure's own spread.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PaperObjSpread, PaperObjSpreadSource, PaperObjSpreadView } from './paperExportTarget';
import { objExportFailureMessage } from './saveObjExport';

/** Where the fold behind the file stands. */
export type PaperObjSpreadPreparation =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'ready'; view: PaperObjSpreadView }
  /** The spread cannot be made, or the fold read at all; `flat` when the file can still be written unspread. */
  | { status: 'failed'; message: string; flat: boolean };

export interface PaperObjSpreadBinding {
  /** A flat figure's Default spread, or a 3D figure's spatial one: what Amount moves. */
  kind: PaperObjSpreadSource['kind'];
  value: PaperObjSpread;
  set: (next: PaperObjSpread) => void;
  preparation: PaperObjSpreadPreparation;
  /** Whether the file can be written as the spread stands. */
  writable: boolean;
}

/** The dialog's spread for `source`, prepared while `active` (OBJ chosen); null for a mesh with none. */
export function usePaperObjSpread(source: PaperObjSpreadSource | undefined, active: boolean): PaperObjSpreadBinding | null {
  const { t } = useTranslation();
  const [value, set] = useState<PaperObjSpread>(() => source?.initial ?? { on: false, amount: 0 });
  const [preparation, setPreparation] = useState<PaperObjSpreadPreparation>({ status: 'idle' });
  const wanted = active && source !== undefined;
  useEffect(() => {
    if (!wanted || !source) return undefined;
    let current = true;
    setPreparation((was) => (was.status === 'idle' ? { status: 'preparing' } : was));
    source.prepare().then(
      (view) => {
        if (current) setPreparation({ status: 'ready', view });
      },
      async (cause: unknown) => {
        // A spread the solver could not make leaves a fold that can still be written flat.
        const flat = await source.unspread();
        if (current) setPreparation({ status: 'failed', message: objExportFailureMessage(cause, t), flat });
      }
    );
    return () => {
      current = false;
    };
  }, [wanted, source, t]);
  if (!source) return null;
  const writable =
    preparation.status === 'ready' || (preparation.status === 'failed' && preparation.flat && !value.on);
  return { kind: source.kind, value, set, preparation, writable };
}
