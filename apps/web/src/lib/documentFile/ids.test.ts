import { describe, expect, it } from 'vitest';

import { randomId } from './ids';

describe('randomId', () => {
  it('is the prefix, then a uuid of its own', () => {
    const id = randomId('step');
    expect(id).toMatch(/^step-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(randomId('step')).not.toBe(id);
  });
});
