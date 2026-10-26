-- Personal supply chain: every producing enterprise receives one chain of its
-- own at activation so it can open production cycles before joining a shared
-- chain. Partners join it through handover acceptance like any other chain.
-- Existing chains stay ordinary chains.
ALTER TABLE supply_chain ADD COLUMN personal boolean NOT NULL DEFAULT false;

-- At most one personal chain per owner organization.
CREATE UNIQUE INDEX supply_chain_one_personal
  ON supply_chain (owner_organization_id) WHERE personal;
