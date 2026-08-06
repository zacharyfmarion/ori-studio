import { describe, expect, it, vi } from 'vitest';
import type { DesignKindDescriptor } from '../designKinds/types';
import { createDocumentRegistry, type RegisteredDocument } from './documentRegistry';
import type { EngineId, EngineLoss } from './engineHost';

/**
 * A design kind whose codec is a fake in-memory engine.
 *
 * Handles are integers into a store of strings, so a full
 * create → edit → serialize → free → hydrate cycle can be asserted exactly. The
 * counters matter as much as the values: the whole point of the registry is
 * *when* it serializes and frees, not just that it can.
 */
function fakeKind(engine: EngineId = 'treemaker') {
  const contents = new Map<number, string>();
  let nextHandle = 1;
  const calls = { create: 0, hydrate: 0, serialize: 0, free: 0 };
  const freed: number[] = [];

  const kind = {
    id: 'fake',
    engine,
    codec: {
      create: vi.fn(async () => {
        calls.create += 1;
        const handle = nextHandle++;
        contents.set(handle, 'new');
        return handle;
      }),
      hydrate: vi.fn(async (text: string) => {
        calls.hydrate += 1;
        const handle = nextHandle++;
        contents.set(handle, text);
        return handle;
      }),
      serialize: vi.fn(async (handle: number) => {
        calls.serialize += 1;
        const text = contents.get(handle);
        if (text === undefined) throw new Error(`serialize on dead handle ${handle}`);
        return text;
      }),
      free: vi.fn(async (handle: number) => {
        calls.free += 1;
        freed.push(handle);
        contents.delete(handle);
      }),
    },
  } as unknown as DesignKindDescriptor;

  return {
    kind,
    calls,
    freed,
    /** Simulate the user editing the document behind a live handle. */
    edit: (handle: number, text: string) => contents.set(handle, text),
    isLive: (handle: number) => contents.has(handle),
    liveCount: () => contents.size,
  };
}

const doc = (id: string, kind: DesignKindDescriptor): RegisteredDocument => ({ id, kind });

/**
 * A stand-in for the engine host's loss channel.
 *
 * `resetEngine` is correctly a no-op for an engine that was never connected, and
 * these tests never connect one — the fake codecs answer without a worker. So the
 * loss source is injected and driven directly, which also keeps each test's
 * listeners to itself instead of sharing one global list.
 */
function fakeEngineLoss() {
  const listeners = new Set<(loss: EngineLoss) => void>();
  return {
    subscribe: (listener: (loss: EngineLoss) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lose: (engine: EngineId) => {
      for (const listener of [...listeners]) listener({ engine });
    },
  };
}

function makeRegistry(options: Parameters<typeof createDocumentRegistry>[0] = {}) {
  return createDocumentRegistry(options);
}

describe('hydration', () => {
  it('creates a document the first time it is used', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));

    expect(handle).toBe(1);
    expect(fake.calls.create).toBe(1);
    expect(fake.calls.hydrate).toBe(0);
    expect(registry.isHot('a')).toBe(true);
  });

  it('reuses the live handle instead of creating twice', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const first = await registry.acquire(doc('a', fake.kind));
    const second = await registry.acquire(doc('a', fake.kind));

    expect(second).toBe(first);
    expect(fake.calls.create).toBe(1);
  });

  it('hydrates from parked text after a park, not from scratch', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));
    fake.edit(handle, 'edited');
    await registry.park('a');

    const rehydrated = await registry.acquire(doc('a', fake.kind));
    expect(fake.calls.create).toBe(1);
    expect(fake.calls.hydrate).toBe(1);
    // The edit survived the round trip — this is the property eviction rests on.
    await expect(registry.serialize(doc('a', fake.kind))).resolves.toBe('edited');
    expect(rehydrated).not.toBe(handle);
  });

  it('hydrates a document adopted from text without creating one', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    registry.adopt('a', 'from a file');

    await registry.acquire(doc('a', fake.kind));
    expect(fake.calls.create).toBe(0);
    expect(fake.calls.hydrate).toBe(1);
    await expect(registry.serialize(doc('a', fake.kind))).resolves.toBe('from a file');
  });
});

describe('parking', () => {
  it('serializes before freeing, and frees exactly once', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));
    await registry.park('a');

    expect(fake.calls.serialize).toBe(1);
    expect(fake.freed).toEqual([handle]);
    expect(fake.isLive(handle)).toBe(false);
    expect(registry.isHot('a')).toBe(false);
    // Serializing a dead handle throws in the fake, so ordering is enforced.
    expect(fake.kind.codec.serialize).toHaveBeenCalledBefore(fake.kind.codec.free as never);
  });

  it('is a no-op for a document that is not hot', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    await registry.park('never-seen');
    expect(fake.calls.free).toBe(0);
  });

  it('does not free twice when two parks race', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    await registry.acquire(doc('a', fake.kind));
    await Promise.all([registry.park('a'), registry.park('a')]);
    expect(fake.calls.free).toBe(1);
  });

  it('still frees the handle when serialization fails', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));
    vi.mocked(fake.kind.codec.serialize).mockRejectedValueOnce(new Error('engine exploded'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await registry.park('a');

    // A leaked handle is the failure mode that matters here — the text is
    // already lost either way.
    expect(fake.freed).toEqual([handle]);
    consoleError.mockRestore();
  });
});

describe('LRU eviction', () => {
  it('keeps at most the hot limit and evicts least-recently-used', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 2 });

    await registry.acquire(doc('a', fake.kind));
    await registry.acquire(doc('b', fake.kind));
    await registry.acquire(doc('c', fake.kind));

    expect(registry.hotIds()).toEqual(['b', 'c']);
    expect(registry.isHot('a')).toBe(false);
    expect(fake.liveCount()).toBe(2);
  });

  it('counts a re-use as recent, so the truly-oldest is evicted', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 2 });

    await registry.acquire(doc('a', fake.kind));
    await registry.acquire(doc('b', fake.kind));
    await registry.acquire(doc('a', fake.kind)); // 'a' is now newer than 'b'
    await registry.acquire(doc('c', fake.kind));

    expect(registry.hotIds()).toEqual(['a', 'c']);
  });

  it('never evicts the document just hydrated', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    await registry.acquire(doc('a', fake.kind));
    await registry.acquire(doc('b', fake.kind));

    expect(registry.isHot('b')).toBe(true);
    expect(registry.isHot('a')).toBe(false);
  });

  it('preserves edits through an eviction', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    const handle = await registry.acquire(doc('a', fake.kind));
    fake.edit(handle, 'important work');
    await registry.acquire(doc('b', fake.kind)); // evicts 'a'

    await expect(registry.serialize(doc('a', fake.kind))).resolves.toBe('important work');
  });
});

describe('pinning', () => {
  it('does not evict a pinned document, even past the limit', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    let release: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      release = resolve;
    });

    const work = registry.pinned(doc('a', fake.kind), async () => {
      await running;
      return 'done';
    });

    await registry.acquire(doc('b', fake.kind));
    // 'a' has an optimize in flight. Exceeding the budget beats freeing the
    // handle being written to.
    expect(registry.isHot('a')).toBe(true);
    expect(registry.hotIds()).toHaveLength(2);

    release();
    await expect(work).resolves.toBe('done');
  });

  it('becomes evictable again once the work finishes', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    await registry.pinned(doc('a', fake.kind), async () => undefined);
    await registry.acquire(doc('b', fake.kind));

    expect(registry.isHot('a')).toBe(false);
  });

  it('unpins when the work throws', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    await expect(
      registry.pinned(doc('a', fake.kind), async () => {
        throw new Error('optimize failed');
      })
    ).rejects.toThrow('optimize failed');

    await registry.acquire(doc('b', fake.kind));
    expect(registry.isHot('a')).toBe(false);
  });

  it('protects the document from the moment pinned() is called, not after it hydrates', async () => {
    // Regression: pinning used to happen *after* `acquire` resolved, so an `acquire` of
    // another document during that window could evict the one being pinned.
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    let release: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Deliberately not awaited: the pin must already hold while `acquire('b')` runs.
    const work = registry.pinned(doc('a', fake.kind), async () => running);
    await registry.acquire(doc('b', fake.kind));

    expect(registry.isHot('a')).toBe(true);
    release();
    await work;
  });

  it('refuses to park a pinned document', async () => {
    // A tab switch mid-optimize must not serialize a torn state or free a handle
    // that is being written to.
    const fake = fakeKind();
    const registry = makeRegistry();

    let release: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = registry.pinned(doc('a', fake.kind), async () => running);
    await Promise.resolve();

    await registry.park('a');
    expect(registry.isHot('a')).toBe(true);
    expect(fake.calls.free).toBe(0);
    expect(fake.calls.serialize).toBe(0);

    release();
    await work;
    // Parkable again once the work is done.
    await registry.park('a');
    expect(registry.isHot('a')).toBe(false);
  });

  it('holds through nested pins and releases only at the end', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 1 });

    await registry.pinned(doc('a', fake.kind), async () =>
      registry.pinned(doc('a', fake.kind), async () => {
        await registry.acquire(doc('b', fake.kind));
        expect(registry.isHot('a')).toBe(true);
      })
    );

    await registry.acquire(doc('c', fake.kind));
    expect(registry.isHot('a')).toBe(false);
  });
});

describe('engine loss', () => {
  it('parks every document on the lost engine without calling the dead client', async () => {
    const treemaker = fakeKind('treemaker');
    const boxPleat = fakeKind('oristudio-bp');
    const engines = fakeEngineLoss();
    const registry = makeRegistry({ subscribeToEngineLoss: engines.subscribe });

    const handle = await registry.acquire(doc('tree', treemaker.kind));
    treemaker.edit(handle, 'work in progress');
    await registry.park('tree');
    await registry.acquire(doc('tree', treemaker.kind));
    await registry.acquire(doc('bp', boxPleat.kind));

    const freesBefore = treemaker.calls.free;
    const serializesBefore = treemaker.calls.serialize;

    engines.lose('treemaker');

    // Both would call a client that can never answer, hanging forever.
    expect(treemaker.calls.free).toBe(freesBefore);
    expect(treemaker.calls.serialize).toBe(serializesBefore);
    expect(registry.isHot('tree')).toBe(false);
    // Documents on other engines are untouched.
    expect(registry.isHot('bp')).toBe(true);
  });

  it('keeps the last parked text so the document can come back', async () => {
    const fake = fakeKind('treemaker');
    const engines = fakeEngineLoss();
    const registry = makeRegistry({ subscribeToEngineLoss: engines.subscribe });

    const handle = await registry.acquire(doc('a', fake.kind));
    fake.edit(handle, 'saved state');
    await registry.park('a');
    await registry.acquire(doc('a', fake.kind));

    engines.lose('treemaker');

    // Edits since the last park are gone with the engine, but the document is
    // not: it rehydrates from the text captured at park time.
    await expect(registry.serialize(doc('a', fake.kind))).resolves.toBe('saved state');
    await registry.acquire(doc('a', fake.kind));
    expect(registry.isHot('a')).toBe(true);
  });

  it('reports the loss to subscribers', async () => {
    const fake = fakeKind('treemaker');
    const engines = fakeEngineLoss();
    const registry = makeRegistry({ subscribeToEngineLoss: engines.subscribe });
    const events: string[] = [];
    registry.subscribe((event) => events.push(`${event.type}:${event.documentId}`));

    await registry.acquire(doc('a', fake.kind));
    engines.lose('treemaker');

    expect(events).toEqual(['hydrated:a', 'parked:a']);
  });

  it('reports a never-parked document as unrecoverable', async () => {
    // A design created and never switched away from has no captured text, so an
    // engine crash really does lose it. The caller needs to know that, rather
    // than being handed an empty document to rehydrate from.
    const fake = fakeKind('treemaker');
    const engines = fakeEngineLoss();
    const registry = makeRegistry({ subscribeToEngineLoss: engines.subscribe });
    const recoverable: boolean[] = [];
    registry.subscribe((event) => {
      if (event.type === 'parked') recoverable.push(event.recoverable);
    });

    await registry.acquire(doc('fresh', fake.kind));
    engines.lose('treemaker');
    expect(recoverable).toEqual([false]);

    // Once it has been parked at least once, the same crash is recoverable.
    await registry.acquire(doc('fresh', fake.kind));
    await registry.park('fresh');
    await registry.acquire(doc('fresh', fake.kind));
    engines.lose('treemaker');
    expect(recoverable).toEqual([false, true, true]);
  });

  it('keeps parked text across a rehydrate, so a later crash is survivable', async () => {
    // Regression: `acquire()` used to consume the parked text, which meant merely
    // reopening a tab made it unrecoverable again.
    const fake = fakeKind('treemaker');
    const engines = fakeEngineLoss();
    const registry = makeRegistry({ subscribeToEngineLoss: engines.subscribe });

    const handle = await registry.acquire(doc('a', fake.kind));
    fake.edit(handle, 'v1');
    await registry.park('a');
    await registry.acquire(doc('a', fake.kind)); // reopened

    engines.lose('treemaker');
    await expect(registry.serialize(doc('a', fake.kind))).resolves.toBe('v1');
  });
});

describe('forget', () => {
  it('frees a live handle and drops the text', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));

    await registry.forget('a');

    expect(fake.freed).toEqual([handle]);
    expect(registry.isHot('a')).toBe(false);
    await expect(registry.serialize(doc('a', fake.kind))).rejects.toThrow('not registered');
  });

  it('drops a parked document without touching the engine', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    await registry.acquire(doc('a', fake.kind));
    await registry.park('a');
    const freesBefore = fake.calls.free;

    await registry.forget('a');

    expect(fake.calls.free).toBe(freesBefore);
    await expect(registry.serialize(doc('a', fake.kind))).rejects.toThrow('not registered');
  });

  it('leaves no live handles behind after every document is forgotten', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 2 });
    for (const id of ['a', 'b', 'c', 'd']) await registry.acquire(doc(id, fake.kind));
    for (const id of ['a', 'b', 'c', 'd']) await registry.forget(id);

    // The leak check: nothing the registry created is still alive in the engine.
    expect(fake.liveCount()).toBe(0);
    expect(registry.hotIds()).toEqual([]);
  });
});

describe('adoptHandle', () => {
  /**
   * The engine runtimes build documents by calling the engine directly —
   * `newDesign`, `loadTmd` — and get a live handle back. Before this existed
   * those handles stayed outside the registry, which is not a tidiness problem:
   * `serialize` threw for an id nothing was registered under (so Duplicate found
   * nothing to copy), `park` had nothing to serialize, and the next `acquire`
   * built a *second*, blank document while the real one leaked.
   */
  it('registers a handle the caller already created', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const outside = await fake.kind.codec.create();
    fake.edit(outside, 'built outside');

    await registry.adoptHandle(doc('a', fake.kind), outside);

    expect(registry.isHot('a')).toBe(true);
    expect(await registry.serialize(doc('a', fake.kind))).toBe('built outside');
  });

  it('does not create a second document when the id is next acquired', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const outside = await fake.kind.codec.create();
    fake.edit(outside, 'built outside');
    const createsBefore = fake.calls.create;

    await registry.adoptHandle(doc('a', fake.kind), outside);

    expect(await registry.acquire(doc('a', fake.kind))).toBe(outside);
    expect(fake.calls.create).toBe(createsBefore);
  });

  it('frees the handle it replaces', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const first = await registry.acquire(doc('a', fake.kind));
    const replacement = await fake.kind.codec.create();

    await registry.adoptHandle(doc('a', fake.kind), replacement);

    expect(fake.freed).toContain(first);
    expect(fake.isLive(replacement)).toBe(true);
  });

  it('drops the parked text of the document it replaces', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));
    fake.edit(handle, 'the old document');
    await registry.park('a');

    const replacement = await fake.kind.codec.create();
    fake.edit(replacement, 'the new document');
    await registry.adoptHandle(doc('a', fake.kind), replacement);
    await registry.park('a');

    // Stale text describes the document that was replaced. Keeping it would make
    // a later crash recover the wrong content rather than none.
    expect(await registry.serialize(doc('a', fake.kind))).toBe('the new document');
  });

  it('counts toward the hot budget', async () => {
    const fake = fakeKind();
    const registry = makeRegistry({ hotLimit: 2 });
    await registry.acquire(doc('a', fake.kind));
    await registry.acquire(doc('b', fake.kind));

    await registry.adoptHandle(doc('c', fake.kind), await fake.kind.codec.create());

    expect(registry.hotIds()).toEqual(['b', 'c']);
  });

  it('is idempotent for the handle a document already holds', async () => {
    const fake = fakeKind();
    const registry = makeRegistry();
    const handle = await registry.acquire(doc('a', fake.kind));

    await registry.adoptHandle(doc('a', fake.kind), handle);

    // Freeing here would kill the very handle being adopted.
    expect(fake.isLive(handle)).toBe(true);
    expect(registry.handleFor('a')).toBe(handle);
  });
});
