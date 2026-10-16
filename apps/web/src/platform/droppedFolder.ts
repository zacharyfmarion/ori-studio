import { pickedFileFromFile, type PickedFile } from './fileService';

/** Capture the entry handles during the drop, before its protected data store closes. */
export function droppedFolderReader(
  transfer: DataTransfer,
): ((recursive: boolean) => Promise<PickedFile[]>) | null {
  const entries = Array.from(transfer.items).flatMap((item) => {
    const entry = item.webkitGetAsEntry?.();
    return entry ? [entry] : [];
  });
  return entries.some((entry) => entry.isDirectory)
    ? (recursive) => readDroppedEntries(entries, recursive)
    : null;
}

/** Enumerate metadata only, with the same opt-in recursion and cap as the native picker. */
export async function readDroppedEntries(
  entries: readonly FileSystemEntry[],
  recursive: boolean,
): Promise<PickedFile[]> {
  const files: PickedFile[] = [];
  let count = 0;
  const visit = async (entry: FileSystemEntry, path: string, depth: number): Promise<void> => {
    if (++count > 10000 || depth > 32)
      throw new Error('The folder contains too many entries. Choose a smaller folder.');
    const name = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ ...pickedFileFromFile(file), name });
    } else if (entry.isDirectory && (depth === 0 || recursive)) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, name, depth + 1);
      }
    }
  };
  for (const entry of entries) await visit(entry, '', 0);
  return files;
}
