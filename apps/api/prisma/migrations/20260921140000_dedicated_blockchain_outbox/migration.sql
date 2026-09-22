-- Separate delivery lifecycle from the immutable Fabric receipt. Business
-- commands write this outbox row in the same ACID transaction as TraceEvent.
CREATE TYPE public.blockchain_outbox_status AS ENUM (
  'PENDING',
  'PROCESSING',
  'RETRY',
  'COMPLETED',
  'DEAD_LETTER'
);

CREATE TABLE public.blockchain_outbox (
  outbox_id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_id uuid NOT NULL,
  status public.blockchain_outbox_status DEFAULT 'PENDING' NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  last_error text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT blockchain_outbox_pkey PRIMARY KEY (outbox_id),
  CONSTRAINT blockchain_outbox_event_id_key UNIQUE (event_id),
  CONSTRAINT chk_blockchain_outbox_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT chk_blockchain_outbox_completed CHECK (
    status <> 'COMPLETED' OR completed_at IS NOT NULL
  ),
  CONSTRAINT chk_blockchain_outbox_processing_lease CHECK (
    status <> 'PROCESSING' OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT blockchain_outbox_event_id_fkey
    FOREIGN KEY (event_id)
    REFERENCES public.trace_event(event_id)
    ON DELETE RESTRICT
    ON UPDATE NO ACTION
);

CREATE INDEX ix_blockchain_outbox_due
  ON public.blockchain_outbox (status, next_attempt_at);

CREATE INDEX ix_blockchain_outbox_lease
  ON public.blockchain_outbox (status, lease_expires_at);

CREATE TRIGGER trg_blockchain_outbox_updated_at
BEFORE UPDATE ON public.blockchain_outbox
FOR EACH ROW
EXECUTE FUNCTION public.fn_set_updated_at();

-- Backfill all historical events. Confirmed rows become completed audit entries;
-- pending/failed rows become retryable jobs with their attempt metadata retained.
INSERT INTO public.blockchain_outbox (
  event_id,
  status,
  attempt_count,
  next_attempt_at,
  last_error,
  completed_at,
  created_at,
  updated_at
)
SELECT
  te.event_id,
  CASE
    WHEN bp.transaction_status = 'CONFIRMED' THEN 'COMPLETED'::public.blockchain_outbox_status
    WHEN bp.transaction_status = 'FAILED' THEN 'RETRY'::public.blockchain_outbox_status
    ELSE 'PENDING'::public.blockchain_outbox_status
  END,
  COALESCE(bp.attempt_count, 0),
  CASE
    WHEN bp.transaction_status = 'CONFIRMED' THEN NULL
    ELSE COALESCE(bp.next_attempt_at, now())
  END,
  bp.last_error,
  CASE
    WHEN bp.transaction_status = 'CONFIRMED'
      THEN COALESCE(bp.recorded_at, bp.updated_at, now())
    ELSE NULL
  END,
  COALESCE(bp.created_at, te.created_at),
  COALESCE(bp.updated_at, te.created_at)
FROM public.trace_event te
LEFT JOIN public.blockchain_proof bp ON bp.event_id = te.event_id;

-- A proof is a confirmed Fabric receipt, never a delivery queue item.
DELETE FROM public.blockchain_proof
WHERE transaction_status <> 'CONFIRMED';
