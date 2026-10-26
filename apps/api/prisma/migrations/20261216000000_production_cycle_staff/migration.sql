-- Staff assigned to a production cycle. A cycle has at least one assignee
-- (enforced by the API on create and on change); tier-3 employees see and
-- write only the cycles they are assigned to. Assignment is operational
-- authorization, not ledger content: no event payload or hash changes.
CREATE TABLE production_cycle_staff (
  cycle_id uuid NOT NULL REFERENCES production_cycle (cycle_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  assigned_by uuid NOT NULL REFERENCES app_user (user_id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, user_id),
  FOREIGN KEY (user_id, organization_id) REFERENCES app_user (user_id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX production_cycle_staff_user ON production_cycle_staff (user_id);

-- Drafts keep their planned assignees until they are linked to a chain.
ALTER TABLE production_cycle_draft
  ADD COLUMN staff_user_ids uuid[] NOT NULL DEFAULT '{}';

-- The single responsible person recorded so far becomes the first assignee.
INSERT INTO production_cycle_staff (cycle_id, user_id, organization_id, assigned_by)
SELECT c.cycle_id, u.user_id, u.organization_id, u.user_id
  FROM production_cycle c
  JOIN app_user u ON u.user_id = c.responsible_user_id AND u.organization_id = c.farm_org_id;
UPDATE production_cycle_draft
   SET staff_user_ids = ARRAY[responsible_user_id]
 WHERE responsible_user_id IS NOT NULL;
