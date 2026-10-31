/** A route change, logout, unmount or newer reload invalidates older responses. */
export class LatestRequest {
  private revision = 0;
  begin() {
    return ++this.revision;
  }
  current(revision: number) {
    return revision === this.revision;
  }
  cancel() {
    this.revision++;
  }
}
