import { ForbiddenException } from '@nestjs/common';

/** A step-up (second factor) failure on an authenticated command. It is a 403
 * on purpose: a 401 makes the web client discard the session. The command
 * transaction has rolled back and nothing is committed, so the idempotency
 * journal must not remember the failure; the same key stays usable once the
 * administrator supplies the correct code. */
export class MfaStepUpException extends ForbiddenException {}
