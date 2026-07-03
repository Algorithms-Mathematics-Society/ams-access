// Serializes an async save so at most one is ever in flight, and coalesces
// any requests that arrive while one is running into exactly ONE fresh
// follow-up — never dropping the latest edit, never firing one network write
// per keystroke.
//
// Why this exists: the contest autosave's network write can take materially
// longer than the debounce that can re-arm it (see client.tsx), so a naive
// wiring can have two overlapping POSTs to /answers in flight at once; if the
// network reorders their responses, older content can land last and silently
// overwrite the candidate's latest keystrokes on a proctored exam. A fix must
// not trade that race for a worse one: `handleSave` is `await`ed by
// run/submit paths that gate on a CONFIRMED save of CURRENT content, so a
// request can never be short-circuited with a stale or false result while
// another save is in flight — see save-coordinator.test.mjs for the
// properties this is required to satisfy (serialization, coalescing,
// freshness, result propagation).
//
// Pure module: no React/@ imports, so it is unit-testable with a mock
// `doSave` under plain `node --test`.
export function createSaveCoordinator(doSave: () => Promise<boolean>): () => Promise<boolean> {
  // The currently in-flight doSave() call, if any.
  let running: Promise<boolean> | null = null;
  // The single shared follow-up promise for every request that arrives while
  // `running` is in flight. At most one is ever created per in-flight save.
  let pending: Promise<boolean> | null = null;

  return function request(): Promise<boolean> {
    if (!running) {
      // Nothing in flight — start immediately.
      running = doSave().finally(() => {
        running = null;
      });
      return running;
    }

    // A save is in flight. Every request that arrives before it settles
    // shares ONE follow-up save (not one each): the follow-up calls doSave()
    // fresh only after the in-flight one settles, so it reads whatever the
    // latest content is at that later point in time — at-or-after every
    // request that coalesced into it, never stale.
    if (!pending) {
      pending = running
        // A rejected in-flight save must not sink the follow-up — the
        // coalesced requests still deserve a fresh attempt.
        .catch(() => false)
        .then(() => {
          pending = null;
          running = doSave().finally(() => {
            running = null;
          });
          return running;
        });
    }
    return pending;
  };
}
