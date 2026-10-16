import type { ComponentProps } from 'react';
import { Download } from 'lucide-react';
import { PreviewDialog } from '../ui/PreviewDialog';

/** Paper exports use the same preview/options frame as other file workflows. */
export function ExportModalFrame(props: Omit<ComponentProps<typeof PreviewDialog>, 'icon'>) {
  return <PreviewDialog {...props} icon={<Download size={15} aria-hidden="true" />} />;
}
