import type { Context } from "fabric-contract-api";

interface IteratorItem {
  value?: { key: string; value: Uint8Array };
  done: boolean;
}

class FakeIterator {
  private index = 0;
  public closed = false;

  public constructor(private readonly values: Array<{ key: string; value: Uint8Array }>) {}

  public async next(): Promise<IteratorItem> {
    if (this.index >= this.values.length) return { done: true };
    const value = this.values[this.index++];
    return { value, done: this.index >= this.values.length };
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

export class FakeStub {
  public readonly state = new Map<string, Uint8Array>();
  public readonly events: Array<{ name: string; payload: Uint8Array }> = [];
  public txId = "tx-0001";
  public channelId = "agritrace";
  public timestamp = { seconds: 1_788_710_400, nanos: 123_000_000 };

  public createCompositeKey(objectType: string, attributes: string[]): string {
    return `\u0000${objectType}\u0000${attributes.join("\u0000")}\u0000`;
  }

  public async getState(key: string): Promise<Uint8Array> {
    return this.state.get(key) ?? new Uint8Array();
  }

  public async putState(key: string, value: Uint8Array): Promise<void> {
    this.state.set(key, Buffer.from(value));
  }

  public getTxID(): string {
    return this.txId;
  }

  public getChannelID(): string {
    return this.channelId;
  }

  public getTxTimestamp(): { seconds: number; nanos: number } {
    return this.timestamp;
  }

  public async setEvent(name: string, payload: Uint8Array): Promise<void> {
    this.events.push({ name, payload: Buffer.from(payload) });
  }

  public async getStateByPartialCompositeKey(objectType: string, attributes: string[]): Promise<FakeIterator> {
    const prefix = `\u0000${objectType}\u0000${attributes.join("\u0000")}\u0000`;
    const values = [...this.state.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, value }));
    return new FakeIterator(values);
  }
}

export class FakeClientIdentity {
  public relayer = true;
  public mspId = "Org1MSP";
  public id = "x509::CN=agri-relayer::CN=ca.org1.example.com";

  public assertAttributeValue(name: string, value: string): boolean {
    return this.relayer && name === "app.role" && value === "relayer";
  }

  public getMSPID(): string {
    return this.mspId;
  }

  public getID(): string {
    return this.id;
  }
}

export function createFakeContext(): {
  ctx: Context;
  stub: FakeStub;
  clientIdentity: FakeClientIdentity;
} {
  const stub = new FakeStub();
  const clientIdentity = new FakeClientIdentity();
  return {
    ctx: { stub, clientIdentity } as unknown as Context,
    stub,
    clientIdentity
  };
}
