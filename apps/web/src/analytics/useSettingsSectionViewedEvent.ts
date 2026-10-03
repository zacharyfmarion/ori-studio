import { useEffect } from 'react';
import { ANALYTICS_EVENTS, type SettingsSectionName } from './events';
import { track } from './runtime';

/**
 * Emit `settings section viewed` for the section the Settings dialog shows: the
 * one it opens on, then each one picked.
 *
 * From the dialog rather than from whatever opened it, so every way in counts —
 * the toolbar's gear calls the store directly and never reaches the
 * `command invoked` chokepoint that File ▸ Settings and its shortcut do.
 */
export function useSettingsSectionViewedEvent(section: SettingsSectionName): void {
  useEffect(() => {
    track(ANALYTICS_EVENTS.settingsSectionViewed, { section });
  }, [section]);
}
