// Global Vitest setup: initialize i18next once so `t('ns:key', 'English default')` resolves
// to the inline English default in every test (matching runtime before locale JSON loads),
// rather than returning the raw key. Importing the app's i18n module triggers its init side
// effect; the http backend's fetches are harmless no-ops under jsdom.
import '../i18n';
