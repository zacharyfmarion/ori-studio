import { describe, expect, it } from 'vitest';

import {
  CP_DETECT_DEFAULT_JUNCTION_SOURCE as GENERATED_JUNCTION_SOURCE,
  CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE as GENERATED_LINE_EVIDENCE_SOURCE,
} from '../generated/cpDetectDefaults.generated';
import {
  CP_DETECT_DEFAULT_JUNCTION_SOURCE,
  CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE,
} from './cpDetectTypes';

// Guardrail for the single source of truth: the browser defaults are generated
// from crates/oristudio-cp-detect/src/defaults.rs on every `build:wasm` (the
// wasm crate exports the same constants, asserted equal on the Rust side by
// default_export_tests::exports_match_canonical_defaults). This test locks the
// TS side: the generated values are the canonical product decode, and
// cpDetectTypes re-exports them unchanged. If anyone hand-edits the generated
// file or the constants drift, this fails (pretest regenerates first).
describe('cp-detect default decode sources', () => {
  it('are the canonical product decode', () => {
    expect(GENERATED_JUNCTION_SOURCE).toBe('dense-model');
    expect(GENERATED_LINE_EVIDENCE_SOURCE).toBe('source-image');
  });

  it('are re-exported unchanged by cpDetectTypes', () => {
    expect(CP_DETECT_DEFAULT_JUNCTION_SOURCE).toBe(GENERATED_JUNCTION_SOURCE);
    expect(CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE).toBe(GENERATED_LINE_EVIDENCE_SOURCE);
  });
});
