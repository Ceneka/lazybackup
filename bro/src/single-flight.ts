/**
 * Collapse concurrent calls into one in-flight run. Used so a slow sync pass
 * cannot overlap with the next timer tick: overlapping passes each enforce
 * quota against the same stale "used" value and write separate partial files
 * for the same object, letting a host fill the friend's disk past quota.
 */
export function createSingleFlight<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  let inFlight: Promise<Result> | null = null;
  return (...args: Args): Promise<Result> => {
    if (inFlight) return inFlight;
    const run = fn(...args);
    inFlight = run;
    void run
      .finally(() => {
        if (inFlight === run) inFlight = null;
      })
      .catch(() => {
        /* caller observes the original rejection */
      });
    return run;
  };
}
