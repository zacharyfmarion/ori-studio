/**
 * The CP tool options, restored on mount and written back as they change.
 *
 * A drop-in for `useState(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS)`: same tuple, same
 * setter. Which keys actually survive a reload — and what counts as a valid
 * stored value — is `lib/cpToolOptionPersistence.ts`'s business; this owns only
 * the lifecycle.
 *
 * # Why writes are debounced, and why they are not deferred to deactivation
 *
 * Writing on every change would write once per keystroke in a number field.
 * Writing on tool deactivation instead would lose a setting whenever the tab is
 * closed with the tool still active, which is the ordinary way people leave.
 * So: on change, a few hundred milliseconds late.
 */
import { useEffect, useState } from 'react';
import {
  readCpToolOptions,
  writeCpToolOptions,
} from '../../lib/cpToolOptionPersistence';
import type { OristudioCpToolOptions } from '../../lib/oristudioCpToolSettings';

/** Long enough to coalesce typing, short enough to survive a quick tab close. */
const WRITE_DEBOUNCE_MS = 300;

export function usePersistedCpToolOptions(): [
  OristudioCpToolOptions,
  React.Dispatch<React.SetStateAction<OristudioCpToolOptions>>,
] {
  const [options, setOptions] = useState<OristudioCpToolOptions>(readCpToolOptions);

  useEffect(() => {
    const timer = window.setTimeout(() => writeCpToolOptions(options), WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [options]);

  return [options, setOptions];
}
