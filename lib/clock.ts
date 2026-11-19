/**
 * Background-safe sleep.
 *
 * On Android, React Native stops JS timers (setTimeout) when the app is backgrounded / the screen
 * locks (JavaTimerManager.onHostPause). Native events still reach JS, so Listen mode calls `tick()`
 * from the silent keep-alive track's status updates (every ~250 ms). A sleep resolves on whichever
 * comes first: the normal timer (foreground, web) or a tick past its deadline (background).
 */
type Waiter = { at: number; resolve: () => void };
let waiters: Waiter[] = [];

export function tick() {
  if (waiters.length === 0) return;
  const now = Date.now();
  for (const w of waiters.filter((x) => x.at <= now)) w.resolve();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const w: Waiter = {
      at: Date.now() + ms,
      resolve: () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        waiters = waiters.filter((x) => x !== w);
        resolve();
      },
    };
    const timer = setTimeout(w.resolve, ms);
    waiters.push(w);
  });
}

/** Resolve with the promise's value, or undefined after `ms` (background-safe). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, sleep(ms).then(() => undefined)]);
}
