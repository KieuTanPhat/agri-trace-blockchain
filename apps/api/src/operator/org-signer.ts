/**
 * Reference remote signer for an organization that keeps its signing key
 * outside AgriTrace. Run it where the key lives; only public values and
 * signatures ever leave.
 *
 *   node dist/operator/org-signer.js keygen --out org-key.pem
 *   node dist/operator/org-signer.js register --key org-key.pem --binding <digest> \
 *     --org <organizationId> --label "Signing service"      # prints the POST body
 *   node dist/operator/org-signer.js sign --key org-key.pem --intent intent.json
 *
 * `intent.json` is the JSON returned by the prepare endpoint (the `data`
 * object or the whole envelope). `sign` re-derives every digest and refuses
 * anything that does not match; it prints { "signature": "..." } for
 * POST /api/signing-intents/:intentId/submit.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  generateSignerKey,
  registrationBody,
  signPreparedIntent,
  type PreparedIntentInput,
  type SigningExpectation,
} from '../modules/signing/org-signer.js';

function options(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined)
      throw new Error(`Expected --name value pairs, got "${argv[i]}"`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const need = (o: Record<string, string>, name: string) => {
  if (!o[name]) throw new Error(`Missing --${name}`);
  return o[name];
};

const [command, ...rest] = process.argv.slice(2);
if (command === '--help') {
  console.log('Usage: node dist/operator/org-signer.js <keygen|register|sign> [--option value ...]');
  process.exit(0);
}
const o = options(rest);
try {
  switch (command) {
    case 'keygen': {
      const out = need(o, 'out');
      if (existsSync(out))
        throw new Error(`${out} already exists; not overwriting`);
      const key = generateSignerKey();
      writeFileSync(out, key.privatePem, { mode: 0o600, flag: 'wx' });
      chmodSync(out, 0o600);
      console.log(
        JSON.stringify({ publicKey: key.publicKey, file: out }, null, 2),
      );
      break;
    }
    case 'register':
      console.log(
        JSON.stringify(
          registrationBody(readFileSync(need(o, 'key'), 'utf8'), {
            bindingDigest: need(o, 'binding'),
            organizationId: need(o, 'org'),
            label: need(o, 'label'),
            keyRef: o['key-ref'],
          }),
          null,
          2,
        ),
      );
      break;
    case 'sign': {
      const parsed = JSON.parse(readFileSync(need(o, 'intent'), 'utf8')) as {
        data?: PreparedIntentInput;
      } & PreparedIntentInput;
      const prepared = parsed.data ?? parsed;
      const expected = JSON.parse(readFileSync(need(o, 'context'), 'utf8')) as SigningExpectation;
      if (!expected || ['chainRef', 'bindingDigest', 'signerOrgRef', 'keyRef', 'entityType', 'entityId', 'operation']
        .some(field => typeof expected[field as keyof SigningExpectation] !== 'string'))
        throw new Error('Independent signing context must include chainRef, bindingDigest, signerOrgRef, keyRef, entityType, entityId and operation');
      const result = signPreparedIntent(
        readFileSync(need(o, 'key'), 'utf8'),
        prepared,
        Date.now(),
        expected,
      );
      console.log(JSON.stringify({ signature: result.signature }));
      break;
    }
    default:
      throw new Error(
        'Usage: org-signer <keygen|register|sign> [--option value ...]',
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
