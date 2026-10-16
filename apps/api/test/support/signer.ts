import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  keyPopMessage,
  signedMessageForIntent,
  type IntentBody,
} from '../../src/modules/trace/signed-commitment.js';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** An organization signer for tests: stands in for the browser WebCrypto key,
 * an HSM or a remote signing service. The private key stays in this object. */
export class TestSigner {
  public readonly publicKey: string;
  private constructor(private readonly privateKey: KeyObject) {
    this.publicKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64url');
  }
  /** Random key, as a real signer generates. */
  public static generate(): TestSigner {
    return new TestSigner(generateKeyPairSync('ed25519').privateKey);
  }
  /** Deterministic key for cross-implementation vectors only. */
  public static fromSeed(seedByte: number): TestSigner {
    return new TestSigner(
      createPrivateKey({
        key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, seedByte)]),
        format: 'der',
        type: 'pkcs8',
      }),
    );
  }
  public sign(message: Buffer): string {
    return sign(null, message, this.privateKey).toString('base64url');
  }
  /** Proof of possession for registering this key. */
  public proof(fields: {
    bindingDigest: string;
    keyRef: string;
    orgRef: string;
  }): string {
    return this.sign(keyPopMessage({ ...fields, publicKey: this.publicKey }));
  }
  /** Signs an intent exactly as a signer must: from the intent body only. */
  public signIntent(intent: IntentBody): string {
    return this.sign(signedMessageForIntent(intent));
  }
}
