import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  CP_TOOL_UNAVAILABLE_CODES,
  cpToolUnavailableMessage,
  forcedAssignmentNotice,
} from './toolUnavailable';

// The real `t` with its inline English defaults: what the UI actually renders.
const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('cpToolUnavailableMessage', () => {
  it('says nothing when the tool has an answer', () => {
    expect(cpToolUnavailableMessage(t, null)).toBeNull();
    expect(cpToolUnavailableMessage(t, undefined)).toBeNull();
  });

  it('stays quiet on a code it does not know, rather than showing an identifier', () => {
    expect(cpToolUnavailableMessage(t, 'SomethingNewerKernelsSay')).toBeNull();
  });

  it('has a distinct sentence for every kernel code', () => {
    const messages = CP_TOOL_UNAVAILABLE_CODES.map((code) => cpToolUnavailableMessage(t, code));
    expect(messages.every((message) => typeof message === 'string' && message.length > 0)).toBe(
      true,
    );
    expect(new Set(messages).size).toBe(CP_TOOL_UNAVAILABLE_CODES.length);
  });

  it('tells the user how many creases are missing when one is not enough', () => {
    expect(cpToolUnavailableMessage(t, 'Overdetermined')).toContain('at least two');
  });
});

describe('forcedAssignmentNotice', () => {
  const candidate = (color?: string) => (color ? { crease: { color } } : {});

  it('says nothing when the tool agrees with the active line type', () => {
    expect(forcedAssignmentNotice(t, [candidate('Red1')], 'Red1')).toBeNull();
  });

  it('names the assignment the tool forced instead', () => {
    expect(forcedAssignmentNotice(t, [candidate('Red1')], 'Blue2')).toContain('mountain');
    expect(forcedAssignmentNotice(t, [candidate('Blue2')], 'Red1')).toContain('valley');
  });

  it('stays quiet when the candidates disagree with each other', () => {
    // A spatial vertex can force a mountain in one gap and a valley in another;
    // "this must be a valley" would then be false for half the screen.
    expect(forcedAssignmentNotice(t, [candidate('Red1'), candidate('Blue2')], 'Red1')).toBeNull();
  });

  it('stays quiet when a candidate carries no assignment at all', () => {
    expect(forcedAssignmentNotice(t, [candidate('Red1'), candidate()], 'Blue2')).toBeNull();
    expect(forcedAssignmentNotice(t, [], 'Blue2')).toBeNull();
  });
});
