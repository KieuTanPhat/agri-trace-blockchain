# On-chain and off-chain data model

## Rule

Fabric stores only what is necessary to prove integrity, ordering, state, and submitter identity. PostgreSQL remains the operational source for complete business records. Raw sensor samples and personal or secret data never enter the public channel ledger.

| Data | On-chain | Off-chain | Reason |
|---|---:|---:|---|
| Event ID, batch ID, event type/time | Yes | Yes | Correlation and audit |
| RFC 8785 version and schema version | Yes | Yes | Reproducible verification |
| SHA-256 `dataHash` | Yes | Yes | Tamper evidence |
| Minimum actor ID, role, organization ID | Yes | Yes | Non-repudiation context |
| Backend auth proof digest/request ID | Yes | Yes | Bind approved command to actor context |
| Fabric transaction ID, MSP and relayer certificate ID | Yes | Yes | Technical submitter evidence |
| Batch lifecycle state and event count | Yes | Yes | State guard and reconciliation |
| Full planting/care/harvest payload | No | Yes | Privacy and query flexibility |
| Raw sensor readings | No | Yes | Volume and privacy |
| Sensor digest summary | Later event digest only | Yes | Compact proof |
| Passwords, JWTs, private keys, refresh tokens | Never | Secret store only | Security |
| Personal contact data | No | Yes, access-controlled | Data minimization |

## Hashing contract

The Backend constructs the schema-versioned payload, validates it as I-JSON, canonicalizes it using RFC 8785, encodes the canonical text as UTF-8, and computes SHA-256. Chaincode receives the resulting lowercase 64-character hexadecimal digest and stores it unchanged. Verification later repeats the same procedure against the off-chain payload and compares it with `GetExpectedHash`.

## Event-specific metadata

`payloadMetadata` is optional, bounded to 8 KiB, and must not contain raw readings, secrets, tokens, passwords, private keys, or unrestricted payload blobs. For `BATCH_CREATED`, only non-sensitive identifiers such as product type, variety, and producer organization reference are appropriate.
