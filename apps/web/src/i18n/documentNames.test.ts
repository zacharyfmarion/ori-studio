import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from './index';
import {
  creasePatternOfTitle,
  generatedCpTitle,
  generatedCreasePatternTitle,
  untitledBpTitle,
  untitledCpTitle,
  untitledCreasePatternTitle,
  untitledDesignTitle,
  untitledTitle,
} from './documentNames';
import { identityTranslate } from './identityTranslate';
import { preloadLocale } from '../test/preloadLocale';

/** A translator that echoes the key it was asked for, ignoring the English default. */
const echoKeys = ((key: string) => key) as unknown as TFunction;

const SIMPLE_NAMES = [
  untitledTitle,
  untitledCpTitle,
  untitledDesignTitle,
  untitledBpTitle,
  untitledCreasePatternTitle,
  generatedCreasePatternTitle,
  generatedCpTitle,
];

describe('documentNames', () => {
  it('asks the translator for every name, under a distinct key', () => {
    // If a name were hard-coded, its entry here would be the prose, not a key.
    const keys = SIMPLE_NAMES.map((name) => name(echoKeys));
    expect(keys).toEqual([
      'common:documentName.untitled',
      'common:documentName.untitledCp',
      'common:documentName.untitledDesign',
      'common:documentName.untitledBp',
      'common:documentName.untitledCreasePattern',
      'common:documentName.generatedCreasePattern',
      'common:documentName.generatedCp',
    ]);
    expect(new Set(keys).size).toBe(SIMPLE_NAMES.length);
  });

  it('reads as it did before the names were localized, with no catalog loaded', () => {
    expect(SIMPLE_NAMES.map((name) => name(i18n.t))).toEqual([
      'Untitled',
      'Untitled CP',
      'Untitled Design',
      'Untitled BP',
      'Untitled crease pattern',
      'Generated crease pattern',
      'Generated CP',
    ]);
    expect(creasePatternOfTitle(i18n.t, 'Crane')).toBe('Crane CP');
  });

  it('gives a pure module the same English through the identity translator', () => {
    expect(SIMPLE_NAMES.map((name) => name(identityTranslate))).toEqual(
      SIMPLE_NAMES.map((name) => name(i18n.t))
    );
  });

  it('answers in the app’s language once its catalog is present', async () => {
    // The catalogs never load under jsdom (no network), so the test supplies the
    // keys and switches language the way the Settings picker does. `preloadLocale`
    // seeds `en` as well, which is what lets the switch back resolve at once.
    preloadLocale('ja');
    i18n.addResourceBundle(
      'ja',
      'common',
      {
        documentName: {
          untitled: '無題',
          untitledCp: '無題の CP',
          creasePatternOf: '{{title}}の CP',
        },
      },
      true,
      true
    );
    await i18n.changeLanguage('ja');
    try {
      expect(untitledTitle(i18n.t)).toBe('無題');
      expect(untitledCpTitle(i18n.t)).toBe('無題の CP');
      // The qualifier lands where the locale put it, which is what interpolating
      // rather than concatenating buys.
      expect(creasePatternOfTitle(i18n.t, '鶴')).toBe('鶴の CP');
      // A name the bundle does not carry still falls back to its English default
      // rather than rendering blank.
      expect(untitledDesignTitle(i18n.t)).toBe('Untitled Design');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
