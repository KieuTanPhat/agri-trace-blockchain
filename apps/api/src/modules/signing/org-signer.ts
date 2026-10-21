import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import {
  INTENT_PROTOCOL,
  intentDigest,
  keyPopMessage,
  payloadDigest,
  signedMessageForIntent,
  type IntentBody,
  type IntentPayload,
} from '../trace/signed-commitment.js';

/**
 * Reference implementation of an organization-controlled signer, for an
 * enterprise that keeps its key outside AgriTrace (a service, an HSM wrapper,
 * a signing workstation). It needs nothing from the platform except the
 * prepared intent: it re-derives every digest itself and refuses to sign
 * anything that does not match what it was shown.
 */
export type PreparedIntentInput = {
  intentId: string;
  operation: 'HANDOVER_OFFER' | 'HANDOVER_CONFIRM' | 'DISTRIBUTION_ATTEST';
  keyRef: string;
  expiresAt: string;
  intent: IntentBody;
  payload: IntentPayload;
  intentDigest: string;
  signedMessage: string;
};

export class SignerRefusal extends Error {}

export type SigningExpectation = Pick<
  IntentBody,
  | 'chainRef'
  | 'bindingDigest'
  | 'signerOrgRef'
  | 'keyRef'
  | 'entityType'
  | 'entityId'
  | 'operation'
>;

export function generateSignerKey(): { privatePem: string; publicKey: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  return { privatePem, publicKey: publicKeyOf(privatePem) };
}

export function publicKeyOf(privatePem: string): string {
  return createPublicKey(createPrivateKey(privatePem))
    .export({ type: 'spki', format: 'der' })
    .toString('base64url');
}

/** The body of POST /supply-chains/:chainId/signing-keys for this key. */
export function registrationBody(
  privatePem: string,
  input: {
    bindingDigest: string;
    organizationId: string;
    label: string;
    keyRef?: string;
  },
) {
  const keyRef = input.keyRef ?? randomUUID();
  const publicKey = publicKeyOf(privatePem);
  const popSignature = sign(
    null,
    keyPopMessage({
      bindingDigest: input.bindingDigest,
      keyRef,
      orgRef: input.organizationId,
      publicKey,
    }),
    createPrivateKey(privatePem),
  ).toString('base64url');
  return { keyRef, label: input.label, publicKey, popSignature };
}

/** Verifies the prepared intent end to end, then signs it. */
export function signPreparedIntent(
  privatePem: string,
  prepared: PreparedIntentInput,
  now = Date.now(),
  expected?: SigningExpectation,
): { signature: string; intentDigest: string } {
  const { intent, payload } = prepared;
  try {
    if (intent.protocol !== INTENT_PROTOCOL)
      throw new SignerRefusal('Unsupported signing protocol');
    if (payloadDigest(payload) !== intent.payloadDigest)
      throw new SignerRefusal('Payload does not match the signed digest');
    if (intentDigest(intent) !== prepared.intentDigest)
      throw new SignerRefusal('Intent digest does not match');
    const message = signedMessageForIntent(intent);
    if (message.toString('base64url') !== prepared.signedMessage)
      throw new SignerRefusal('Signed message does not match the intent');
  } catch (error) {
    if (error instanceof SignerRefusal) throw error;
    throw new SignerRefusal('Intent is malformed');
  }
  if (
    intent.keyRef !== prepared.keyRef ||
    intent.intentId !== prepared.intentId
  )
    throw new SignerRefusal('Intent names another key or request');
  if (
    prepared.operation !== intent.operation ||
    prepared.expiresAt !== intent.notAfter
  )
    throw new SignerRefusal(
      'Displayed operation or expiry differs from the intent',
    );
  if (
    expected &&
    Object.entries(expected).some(
      ([field, value]) => intent[field as keyof IntentBody] !== value,
    )
  )
    throw new SignerRefusal(
      'Intent differs from the independently reviewed context',
    );
  if (
    !Number.isFinite(Date.parse(intent.notAfter)) ||
    Date.parse(intent.notAfter) <= now
  )
    throw new SignerRefusal('Intent has expired');
  return {
    signature: sign(
      null,
      signedMessageForIntent(intent),
      createPrivateKey(privatePem),
    ).toString('base64url'),
    intentDigest: prepared.intentDigest,
  };
}
