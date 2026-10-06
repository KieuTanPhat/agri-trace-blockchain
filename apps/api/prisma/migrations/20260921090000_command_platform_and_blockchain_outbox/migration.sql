-- Align the database with the command platform and blockchain outbox.
ALTER TYPE public.blockchain_transaction_status RENAME VALUE 'COMMITTED' TO 'CONFIRMED';

ALTER TABLE public.production_cycle
  ADD COLUMN max_harvest_quantity numeric(14,3),
  ADD COLUMN harvest_unit varchar(30),
  ADD CONSTRAINT chk_cycle_harvest_limit
    CHECK (max_harvest_quantity IS NULL OR max_harvest_quantity > 0),
  ADD CONSTRAINT chk_cycle_harvest_unit
    CHECK (max_harvest_quantity IS NULL OR harvest_unit IS NOT NULL);

ALTER TABLE public.blockchain_proof
  ADD COLUMN channel_id varchar(100) NOT NULL DEFAULT 'agritrace',
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error text,
  ADD CONSTRAINT chk_blockchain_attempt_count CHECK (attempt_count >= 0);

DROP INDEX IF EXISTS public.ix_blockchain_proof_status;
CREATE INDEX ix_blockchain_proof_status
  ON public.blockchain_proof (transaction_status, next_attempt_at);

CREATE UNIQUE INDEX uq_plot_farm_name
  ON public.plot (farm_id, name);

-- State columns are backend-owned. These triggers reject invalid transition
-- jumps even if a future code path bypasses the command services.
CREATE OR REPLACE FUNCTION public.fn_validate_cycle_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_state = OLD.current_state THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.current_state = 'CREATED' AND NEW.current_state IN ('PLANTED', 'CANCELLED')) OR
    (OLD.current_state = 'PLANTED' AND NEW.current_state IN ('GROWING', 'COMPLETED', 'CANCELLED')) OR
    (OLD.current_state = 'GROWING' AND NEW.current_state IN ('COMPLETED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid production cycle transition: % -> %', OLD.current_state, NEW.current_state;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_cycle_state_transition
BEFORE UPDATE OF current_state ON public.production_cycle
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_cycle_state_transition();

CREATE OR REPLACE FUNCTION public.fn_validate_shipment_state_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'CREATED' AND NEW.status IN ('IN_TRANSIT', 'FAILED')) OR
    (OLD.status = 'IN_TRANSIT' AND NEW.status IN ('ARRIVED', 'FAILED')) OR
    (OLD.status = 'ARRIVED' AND NEW.status IN ('DELIVERED', 'REJECTED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'invalid shipment transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_shipment_state_transition
BEFORE UPDATE OF status ON public.shipment
FOR EACH ROW EXECUTE FUNCTION public.fn_validate_shipment_state_transition();
