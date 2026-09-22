import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { SITE_NAME, SITE_TITLE } from '../seo/siteMeta';
import { formatWindowTitle } from './windowTitle';

describe('window title formatting', () => {
  it('formats clean web titles', () => {
    expect(
      formatWindowTitle({ projectTitle: 'Crane base', dirty: false, surface: 'web' })
    ).toBe('Crane base - Ori Studio');
  });

  it('marks dirty desktop titles', () => {
    expect(
      formatWindowTitle({ projectTitle: 'Crane base', dirty: true, surface: 'desktop' })
    ).toBe('*Crane base - Ori Studio');
  });

  it('names the open file rather than the project, extension included', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'folded model metadata',
        dirty: false,
        fileName: 'dragon.osf',
        filePath: '/Users/someone/Documents/dragon.osf',
      })
    ).toBe('dragon.osf - Ori Studio');
  });

  it('still marks the file title dirty', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Dragon',
        dirty: true,
        fileName: 'dragon.osf',
        filePath: '/tmp/dragon.osf',
      })
    ).toBe('*dragon.osf - Ori Studio');
  });

  /**
   * The reason the gate is the path and not the name. `currentFileName` is never
   * empty — a project that has never been saved carries the *synthesized*
   * `Untitled.osf` from `defaultNativeFilename` — so a name-based check would
   * title the window after a file that does not exist.
   */
  it('names a blank project Untitled in the language of the translator it is given', () => {
    expect(formatWindowTitle({ projectTitle: '   ', dirty: false, surface: 'web' })).toBe(
      'Untitled - Ori Studio'
    );
    const inJapanese = ((_key: string) => '無題') as unknown as TFunction;
    expect(
      formatWindowTitle({ projectTitle: '   ', dirty: true, surface: 'web', t: inJapanese })
    ).toBe('*無題 - Ori Studio');
  });

  it('ignores a synthesized filename when nothing has been written to disk', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Untitled',
        dirty: false,
        fileName: 'Untitled.osf',
        filePath: null,
      })
    ).toBe('Untitled - Ori Studio');
  });

  /**
   * On a site page there is no document to name, and the two surfaces want
   * genuinely different strings for it.
   *
   * The web one is the search result, so it has to be the page's title exactly as
   * `index.html` serves it — `useWindowTitle` running on `/welcome` and overwriting
   * that with the blank project's name is what Google indexed as
   * "Ori Studio: Untitled". A title bar is not a search result and not a tab, so
   * desktop takes the name alone rather than a sentence written for a result.
   *
   * The project fields are populated in both cases: what makes a page not a
   * document is the route, not an empty store.
   */
  it('titles a site page by its own title on web', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: true,
        pageTitle: SITE_TITLE,
        surface: 'web',
      })
    ).toBe(SITE_TITLE);
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: true,
        pageTitle: 'Download Ori Studio for macOS, Windows and Linux',
        surface: 'web',
      })
    ).toBe('Download Ori Studio for macOS, Windows and Linux');
  });

  it('titles a site page with just the app name on desktop', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: true,
        pageTitle: SITE_TITLE,
        surface: 'desktop',
      })
    ).toBe(SITE_NAME);
  });

  it('keeps naming the project on web, where no path is ever produced', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: false,
        fileName: 'crane.osf',
        filePath: null,
        surface: 'web',
      })
    ).toBe('Crane base - Ori Studio');
  });
});
