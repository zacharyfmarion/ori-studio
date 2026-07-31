import { FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DropTargetPolicy } from '../lib/fileDrop';

interface FileDropOverlayProps {
  visible: boolean;
  policy: DropTargetPolicy;
}

/**
 * The "you can drop that here" affordance.
 *
 * The copy is per-target, not per-file: during a drag the browser withholds
 * `dataTransfer.files`, and `.cp`, `.fold`, `.ori`, and `.orh` all report an
 * empty or `application/octet-stream` MIME type — so there is no way to know
 * which document is inbound until it lands. Naming the file, and refusing an
 * unsupported one, happens on drop.
 */
export function FileDropOverlay({ visible, policy }: FileDropOverlayProps) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <div className="file-drop-overlay" aria-hidden="true">
      <div className="file-drop-overlay__badge">
        <FileDown size={18} aria-hidden="true" />
        <span>
          {policy === 'open-or-import'
            ? t('common:fileDrop.openOrImport', 'Drop to open or import')
            : t('common:fileDrop.open', 'Drop to open')}
        </span>
      </div>
    </div>
  );
}
