import { expect, it } from 'vitest';
import { readDroppedEntries } from './droppedFolder';

const file = (name: string) =>
  ({
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (f: File) => void) => resolve(new File(['cp'], name)),
  }) as FileSystemFileEntry;
const dir = (name: string, children: FileSystemEntry[]) =>
  ({
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (resolve: (e: FileSystemEntry[]) => void) =>
          resolve(at < children.length ? [children[at++]!] : []),
      };
    },
  }) as FileSystemDirectoryEntry;
it('exhausts directory-reader batches and only includes descendants when requested', async () => {
  const root = dir('root', [file('2.cp'), dir('nested', [file('1.svg')]), file('10.cp')]);
  expect((await readDroppedEntries([root], false)).map((f) => f.name)).toEqual(['root/2.cp', 'root/10.cp']);
  const recursive = await readDroppedEntries([root], true);
  expect(recursive.map((f) => f.name)).toEqual(['root/2.cp', 'root/nested/1.svg', 'root/10.cp']);
  expect(recursive[0]?.size).toBe(2);
});
