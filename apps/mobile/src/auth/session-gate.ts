/** Serializes secure-storage mutations and rejects late responses from an old login. */
export class SessionGate {
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  get version() {
    return this.generation;
  }
  next() {
    return ++this.generation;
  }
  current(version: number) {
    return version === this.generation;
  }
  write(operation: () => Promise<void>) {
    const next = this.writes.then(operation, operation);
    this.writes = next.catch(() => undefined);
    return next;
  }
}
