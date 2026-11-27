import { describe, expect, test } from 'bun:test';
import { createSingleFlight } from './single-flight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSingleFlight', () => {
  test('overlapping calls share one run and the next call starts fresh', async () => {
    let gate = deferred<number>();
    let calls = 0;
    const run = createSingleFlight(async () => {
      calls += 1;
      return gate.promise;
    });

    const first = run();
    const second = run();
    expect(calls).toBe(1);
    expect(second).toBe(first);

    gate.resolve(7);
    expect(await first).toBe(7);
    expect(await second).toBe(7);

    gate = deferred<number>();
    const third = run();
    expect(calls).toBe(2);
    gate.resolve(8);
    expect(await third).toBe(8);
  });

  test('a rejected run releases the slot for the next attempt', async () => {
    let calls = 0;
    const run = createSingleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return 'ok';
    });

    await expect(run()).rejects.toThrow('boom');
    expect(await run()).toBe('ok');
    expect(calls).toBe(2);
  });
});
