import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { preloadLocale } from '../../test/preloadLocale';
import { useWorkspaceStore } from '../workspaceStore';
import { initialDesignTabs, singleBoxPleatDesignTab } from './designTabs';

/**
 * The store's initial state is built at module load, before any catalog could
 * have arrived, so its placeholder names are English whatever language the app
 * is about to run in. `store.ts` names them again when i18next announces the
 * language — and only the names still carrying the placeholder.
 */

const JA = {
  documentName: { untitled: '無題', untitledDesign: '無題のデザイン' },
};

async function switchTo(locale: string) {
  await i18n.changeLanguage(locale);
}

function state() {
  return useWorkspaceStore.getState();
}

beforeEach(async () => {
  // The catalogs never load under jsdom (no network); seed the one bundle the
  // placeholders read and make every switch resolve at once.
  preloadLocale('ja');
  i18n.addResourceBundle('ja', 'common', JA, true, true);
  await switchTo('en');
  useWorkspaceStore.setState({
    workspaceTitle: 'Untitled',
    currentFileName: 'Untitled.osf',
    currentFilePath: null,
    projectEstablished: false,
    ...initialDesignTabs(),
  });
});

describe('placeholder names', () => {
  it('are named in the app’s language once its catalog arrives, and again on a switch', async () => {
    await switchTo('ja');
    try {
      expect(state().workspaceTitle).toBe('無題');
      expect(state().currentFileName).toBe('無題.osf');
      expect(state().designTabs.map((tab) => tab.title)).toEqual(['無題のデザイン']);
    } finally {
      await switchTo('en');
    }
    expect(state().workspaceTitle).toBe('Untitled');
    expect(state().currentFileName).toBe('Untitled.osf');
    expect(state().designTabs.map((tab) => tab.title)).toEqual(['Untitled Design']);
  });

  it('are named the moment the language’s common catalog lands, before every namespace has', () => {
    // The cold path: i18next resolved the language at init and its catalogs are
    // arriving one by one. The blank crease pattern on `/edit` is named off the
    // same event and establishes the project a worker round-trip later, so the
    // placeholders have to be renamed here rather than at `languageChanged`.
    i18n.removeResourceBundle('en', 'common');
    useWorkspaceStore.setState({ workspaceTitle: 'Untitled', currentFileName: 'Untitled.osf' });
    i18n.addResourceBundle('en', 'common', { documentName: { untitled: 'Unnamed' } }, true, true);
    expect(state().workspaceTitle).toBe('Unnamed');
    expect(state().currentFileName).toBe('Unnamed.osf');
    // Back to the real English, so the placeholder the later cases expect is in place.
    i18n.addResourceBundle('en', 'common', { documentName: { untitled: 'Untitled' } }, true, true);
    expect(state().workspaceTitle).toBe('Untitled');
  });

  it('leave an established project’s title alone, even one really called Untitled', async () => {
    useWorkspaceStore.setState({ projectEstablished: true });
    await switchTo('ja');
    try {
      expect(state().workspaceTitle).toBe('Untitled');
      expect(state().currentFileName).toBe('Untitled.osf');
      // The chooser tab has chosen nothing, so its default is nobody's.
      expect(state().designTabs[0]?.title).toBe('無題のデザイン');
    } finally {
      await switchTo('en');
    }
  });

  it('leave a name the user gave a tab alone', async () => {
    const [tab] = state().designTabs;
    useWorkspaceStore.setState({ designTabs: [{ ...tab!, title: 'My plan' }] });
    await switchTo('ja');
    try {
      expect(state().designTabs[0]?.title).toBe('My plan');
      expect(state().workspaceTitle).toBe('無題');
    } finally {
      await switchTo('en');
    }
    expect(state().designTabs[0]?.title).toBe('My plan');
  });

  it('leave a tab that has claimed a design alone', async () => {
    // Same default title, but the tab is authoring something now.
    useWorkspaceStore.setState(singleBoxPleatDesignTab({}, 'Untitled Design'));
    await switchTo('ja');
    try {
      expect(state().designTabs[0]?.title).toBe('Untitled Design');
    } finally {
      await switchTo('en');
    }
  });
});
