export interface NavigationScheduler {
  delay(callback: () => void, milliseconds: number): () => void;
  frame(callback: () => void): () => void;
}

const scheduler: NavigationScheduler = {
  delay(callback, milliseconds) {
    const id = setTimeout(callback, milliseconds);
    return () => clearTimeout(id);
  },
  frame(callback) {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  },
};

/** Called from a focused screen effect, after the authenticated render commits.
 * Separate navigation from auth/keyboard/loading updates. This settling window
 * is a scoped workaround, NOT an acknowledgement from the Android renderer.
 */
export function deferAuthNavigation(
  navigate: () => void,
  clock: NavigationScheduler = scheduler,
): () => void {
  let cancelled = false;
  let completed = false;
  let cancelPending: () => void = () => {};
  cancelPending = clock.delay(() => {
    if (cancelled) return;
    cancelPending = clock.frame(() => {
      if (cancelled) return;
      cancelPending = clock.frame(() => {
        if (cancelled || completed) return;
        completed = true;
        navigate();
      });
    });
  }, 300);
  return () => {
    cancelled = true;
    cancelPending();
  };
}
