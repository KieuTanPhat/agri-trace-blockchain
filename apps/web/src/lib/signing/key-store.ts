/** Device-local storage of organization signing keys. The private part is a
 * non-extractable CryptoKey: scripts (including ours) can ask it to sign but
 * can never read its bytes, and it is never sent anywhere. */
export interface StoredSigningKey {
  /** The key reference registered with the API (also the primary key here). */
  id: string;
  chainId: string;
  organizationId: string;
  label: string;
  publicKey: string;
  privateKey: CryptoKey;
  createdAt: string;
}

export interface KeyStore {
  put(key: StoredSigningKey): Promise<void>;
  get(id: string): Promise<StoredSigningKey | undefined>;
  list(chainId: string, organizationId: string): Promise<StoredSigningKey[]>;
  remove(id: string): Promise<void>;
}

export class MemoryKeyStore implements KeyStore {
  private readonly keys = new Map<string, StoredSigningKey>();
  async put(key: StoredSigningKey) {
    this.keys.set(key.id, key);
  }
  async get(id: string) {
    return this.keys.get(id);
  }
  async list(chainId: string, organizationId: string) {
    return [...this.keys.values()].filter(
      (key) => key.chainId === chainId && key.organizationId === organizationId,
    );
  }
  async remove(id: string) {
    this.keys.delete(id);
  }
}

const DB_NAME = "agritrace-signing";
const STORE = "keys";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export class IndexedDbKeyStore implements KeyStore {
  async put(key: StoredSigningKey) {
    await run("readwrite", (store) => store.put(key));
  }
  async get(id: string) {
    return (await run("readonly", (store) => store.get(id))) as
      | StoredSigningKey
      | undefined;
  }
  async list(chainId: string, organizationId: string) {
    const all = (await run("readonly", (store) =>
      store.getAll(),
    )) as StoredSigningKey[];
    return all.filter(
      (key) => key.chainId === chainId && key.organizationId === organizationId,
    );
  }
  async remove(id: string) {
    await run("readwrite", (store) => store.delete(id));
  }
}
