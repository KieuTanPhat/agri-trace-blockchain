-- Processors take part in chains and record distribution and processing
-- events on the ledger like other stages; they need their own chain role.
ALTER TYPE "ScopedRole" ADD VALUE IF NOT EXISTS 'PROCESSOR';
