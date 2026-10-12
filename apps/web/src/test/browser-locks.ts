/** Browser Web Locks serialize each name independently. An auth refresh can
 * acquire its own lock while a command recovery lock is held. */
export function installBrowserLocks() {
  const original = Object.getOwnPropertyDescriptor(window.navigator, "locks");
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      request(name: string, work: () => Promise<unknown>) {
        const result = (queues.get(name) ?? Promise.resolve())
          .catch(() => {})
          .then(work);
        queues.set(
          name,
          result.catch(() => {}),
        );
        return result;
      },
    },
  });
  return () => {
    if (original) Object.defineProperty(window.navigator, "locks", original);
    else Reflect.deleteProperty(window.navigator, "locks");
  };
}
