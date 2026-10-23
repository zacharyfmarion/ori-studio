import { describe, expect, it, vi } from 'vitest';
import { createFoldSessionAnswers, type FoldAnswer } from './foldSessionAnswers';

type Query = (engine: unknown, state: number) => Promise<unknown>;

const scene: Query = async () => 'scene';
const summary: Query = async () => 'summary';
const at = (id: number) => ({ generation: 0, id });
const answered = <T>(value: T): FoldAnswer<T> => ({ status: 'answered', value });

describe('the session’s answers to pure queries', () => {
  it('asks once per query and state, sharing an answer on its way and keeping one that came', async () => {
    const answers = createFoldSessionAnswers<Query>(8);
    const ask = vi.fn(async () => answered('frame of 1'));
    expect(answers.peek(at(1), scene)).toBeNull();

    const first = answers.get(at(1), scene, ask);
    const second = answers.get(at(1), scene, ask);
    expect(second).toBe(first);
    await expect(first).resolves.toEqual(answered('frame of 1'));
    expect(answers.peek(at(1), scene)).toEqual({ value: 'frame of 1' });
    await answers.get(at(1), scene, ask);
    expect(ask).toHaveBeenCalledTimes(1);

    // Another query, or another state, is asked on its own.
    await answers.get(at(1), summary, async () => answered('summary of 1'));
    await answers.get(at(2), scene, async () => answered('frame of 2'));
    expect(answers.peek(at(1), summary)).toEqual({ value: 'summary of 1' });
    expect(answers.peek(at(2), scene)).toEqual({ value: 'frame of 2' });
    // A state of another engine is another state.
    expect(answers.peek({ generation: 1, id: 1 }, scene)).toBeNull();
  });

  it('keeps nothing for a state not held, or an error, so the next ask goes to the engine', async () => {
    const answers = createFoldSessionAnswers<Query>(8);
    await answers.get(at(1), scene, async () => ({ status: 'unavailable' }));
    expect(answers.peek(at(1), scene)).toBeNull();
    await expect(answers.get(at(1), scene, async () => Promise.reject(new Error('lost')))).rejects.toThrow('lost');
    const ask = vi.fn(async () => answered('frame'));
    await answers.get(at(1), scene, ask);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('keeps the most recently used answers of each query', async () => {
    const answers = createFoldSessionAnswers<Query>(2);
    await answers.get(at(1), scene, async () => answered(1));
    await answers.get(at(2), scene, async () => answered(2));
    // Used again: 1 is the newest now.
    expect(answers.peek(at(1), scene)).toEqual({ value: 1 });
    await answers.get(at(3), scene, async () => answered(3));
    expect(answers.peek(at(2), scene)).toBeNull();
    expect(answers.peek(at(1), scene)).toEqual({ value: 1 });
    expect(answers.peek(at(3), scene)).toEqual({ value: 3 });
  });

  it('forgets every answer on clear, and keeps none that comes after it', async () => {
    const answers = createFoldSessionAnswers<Query>(8);
    await answers.get(at(1), scene, async () => answered('before'));
    let answer: (value: FoldAnswer<string>) => void = () => undefined;
    const late = answers.get(at(2), scene, () => new Promise<FoldAnswer<string>>((resolve) => (answer = resolve)));
    answers.clear();
    answer(answered('late'));
    // The caller still hears it.
    await expect(late).resolves.toEqual(answered('late'));
    expect(answers.peek(at(1), scene)).toBeNull();
    expect(answers.peek(at(2), scene)).toBeNull();
  });
});
