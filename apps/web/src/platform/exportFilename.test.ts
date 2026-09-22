import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { exportFilename } from './exportFilename';

/** A translator that answers every key with one marker, standing in for a locale. */
const untitledIn = (word: string) => ((_key: string) => word) as unknown as TFunction;

describe('exportFilename', () => {
  it('keeps a plain title and adds the extension', () => {
    expect(exportFilename('Crane', 'svg')).toBe('Crane.svg');
    expect(exportFilename('crane.svg', 'svg')).toBe('crane.svg');
  });

  it('turns spaces and punctuation a filesystem objects to into single hyphens', () => {
    expect(exportFilename('Crane v2', 'osf')).toBe('Crane-v2.osf');
    expect(exportFilename('Untitled CP', 'osf')).toBe('Untitled-CP.osf');
    expect(exportFilename('a/b:c?d*e"f<g>h|i', 'fold')).toBe('a-b-c-d-e-f-g-h-i.fold');
    expect(exportFilename('  --Crane--  ', 'png')).toBe('Crane.png');
  });

  /**
   * The rule used to be ASCII-only, which made a project a Japanese user named
   * "鶴" save as `Untitled.osf`, and a German "Übung" as `bung.osf` — and would
   * have done the same to every localized "Untitled" the moment the default title
   * stopped being English. Letters are letters in any script.
   */
  it('keeps letters, marks and digits from any script', () => {
    expect(exportFilename('鶴', 'osf')).toBe('鶴.osf');
    expect(exportFilename('無題の CP', 'osf')).toBe('無題の-CP.osf');
    expect(exportFilename('Übung 3', 'svg')).toBe('Übung-3.svg');
    expect(exportFilename('Sans titre', 'osf')).toBe('Sans-titre.osf');
    expect(exportFilename('Без названия', 'osf')).toBe('Без-названия.osf');
    expect(exportFilename('제목 없음', 'osf')).toBe('제목-없음.osf');
    // A combining mark (decomposed "é") stays attached to its letter.
    expect(exportFilename('café', 'svg')).toBe('café.svg');
  });

  it('names a blank title Untitled', () => {
    expect(exportFilename('', 'osf')).toBe('Untitled.osf');
    expect(exportFilename('   ', 'osf')).toBe('Untitled.osf');
  });

  it('names a title that sanitizes to nothing the same way', () => {
    expect(exportFilename('***', 'osf')).toBe('Untitled.osf');
  });

  it('takes the fallback name from the translator it is given', () => {
    expect(exportFilename('', 'osf', untitledIn('無題'))).toBe('無題.osf');
    expect(exportFilename('???', 'osf', untitledIn('Sans titre'))).toBe('Sans-titre.osf');
  });
});
