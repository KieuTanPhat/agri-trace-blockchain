-- Internal member code shown in the member list (NV0001, NV0002 … per
-- organization). New invitations carry the code; the account keeps it on
-- acceptance. Existing enterprise members are numbered by creation order.
-- Invitations already issued stay untouched (their history is immutable) and
-- receive a code when they are accepted.
ALTER TABLE app_user ADD COLUMN member_code varchar(20)
  CHECK (member_code IS NULL OR member_code ~ '^NV[0-9]{4,}$');
ALTER TABLE enterprise_invitation ADD COLUMN member_code varchar(20)
  CHECK (member_code IS NULL OR member_code ~ '^NV[0-9]{4,}$');

UPDATE app_user u
   SET member_code = 'NV' || lpad(x.rn::text, 4, '0')
  FROM (SELECT user_id,
               row_number() OVER (PARTITION BY organization_id
                                  ORDER BY created_at, user_id) AS rn
          FROM app_user
         WHERE organization_id IS NOT NULL) x
 WHERE u.user_id = x.user_id;

CREATE UNIQUE INDEX ux_app_user_member_code
  ON app_user (organization_id, member_code) WHERE member_code IS NOT NULL;
