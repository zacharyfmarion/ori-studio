/**
 * The latest-wins rule over a client of the caller's choosing. Fold's own
 * tests (`store/workspaceStore/foldSequenceRuntime.test.ts`) hold the rule
 * through its worker; these hold what the channel adds by being generic.
 */
import { describe, expect, it } from 'vitest';
import { createLatestWinsChannel, type LatestWinsSend } from './latestWinsChannel';

interface Client {
  readonly name: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createLatestWinsChannel', () => {
  it('asks through the send it was given, with the client that send supplies', async () => {
    const sent: string[] = [];
    const send: LatestWinsSend<Client> = (ask) => {
      sent.push('sent');
      return ask({ name: 'engine 1' });
    };
    const channel = createLatestWinsChannel(send);
    await expect(channel.request(async (client) => client.name)).resolves.toEqual({
      status: 'answered',
      value: 'engine 1',
    });
    expect(sent).toEqual(['sent']);
  });

  it('never sends a request that was replaced while it waited', async () => {
    const first = deferred<string>();
    const asked: string[] = [];
    const channel = createLatestWinsChannel<Client>((ask) => ask({ name: 'engine' }));

    const a = channel.request(() => {
      asked.push('a');
      return first.promise;
    });
    const b = channel.request(async () => {
      asked.push('b');
      return 'b';
    });
    const c = channel.request(async () => {
      asked.push('c');
      return 'c';
    });

    await expect(b).resolves.toEqual({ status: 'superseded' });
    first.resolve('a');
    await expect(a).resolves.toEqual({ status: 'superseded' });
    await expect(c).resolves.toEqual({ status: 'answered', value: 'c' });
    expect(asked).toEqual(['a', 'c']);
  });

  it('a send that throws rejects the newest request and frees the channel', async () => {
    const boom = { code: 'engine_gone', message: 'no engine' };
    let fail = true;
    const channel = createLatestWinsChannel<Client>((ask) => {
      if (fail) throw boom;
      return ask({ name: 'engine' });
    });
    await expect(channel.request(async () => 1)).rejects.toBe(boom);
    fail = false;
    await expect(channel.request(async () => 2)).resolves.toEqual({ status: 'answered', value: 2 });
  });
});
