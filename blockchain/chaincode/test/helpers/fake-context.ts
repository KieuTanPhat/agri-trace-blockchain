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

  public async getStateByPartialCompositeKeyWithPagination(
    objectType: string,
    attributes: string[],
    pageSize: number,
    bookmark: string
  ): Promise<{ iterator: FakeIterator; metadata: { bookmark: string; fetchedRecordsCount: number } }> {
    const prefix = `\u0000${objectType}\u0000${attributes.join("\u0000")}\u0000`;
    const matching = [...this.state.entries()]
      .filter(([key]) => key.startsWith(prefix) && (!bookmark || key > bookmark))
      .sort(([left], [right]) => left.localeCompare(right));
    const page = matching.slice(0, pageSize).map(([key, value]) => ({ key, value }));
    return {
      iterator: new FakeIterator(page),
      metadata: {
        bookmark: matching.length > pageSize ? (page.at(-1)?.key ?? "") : "",
        fetchedRecordsCount: page.length
      }
    };
  }
}

export class FakeClientIdentity {
  public relayer = true;
  public mspId = "Org1MSP";
  public id = "x509::CN=agri-relayer::CN=ca.org1.example.com";
  /** Extra enrollment attributes; `app.role` falls back to `relayer`. */
  public attributes: Record<string, string> = {};
  /** Distinct fake DER bytes per identity (base64 body of the PEM). */
  public certBody = Buffer.from("fake-relayer-certificate-der").toString("base64");

  public assertAttributeValue(name: string, value: string): boolean {
    return this.getAttributeValue(name) === value;
  }

  public getAttributeValue(name: string): string | null {
    if (name in this.attributes) return this.attributes[name];
    return name === "app.role" && this.relayer ? "relayer" : null;
  }

  public getIDBytes(): Uint8Array {
    return Buffer.from(`-----BEGIN CERTIFICATE-----
${this.certBody}
-----END CERTIFICATE-----
`);
  }

  public as(identity: { role: string; msp: string; authority?: string; cert?: string }): this {
    this.attributes = {
      "app.role": identity.role,
      ...(identity.authority ? { "app.authority": identity.authority } : {}),
    };
    this.mspId = identity.msp;
    this.id = `x509::CN=${identity.role}-${identity.msp}`;
    this.certBody = Buffer.from(identity.cert ?? `cert-${identity.role}-${identity.msp}`).toString("base64");
    return this;
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
