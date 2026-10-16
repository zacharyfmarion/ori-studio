import { useTranslation } from 'react-i18next';
import type { PickedFile } from '../../platform/fileService';
import styles from './ImportFileList.module.css';

export function ImportFileList({ files, currentName }: {
  files: readonly PickedFile[];
  currentName?: string;
}) {
  const { t } = useTranslation();
  return (
    <ol className={styles.files} aria-label={t('panels:diagram.import.order', 'Import order')}>
      {files.map((file, index) => (
        <li key={index} data-import-file="" data-current={currentName === file.name || undefined}>
          <span className={styles.fileIndex} aria-hidden="true">{index + 1}</span>
          <span className={styles.fileName} title={file.name}>{file.name}</span>
        </li>
      ))}
    </ol>
  );
}
