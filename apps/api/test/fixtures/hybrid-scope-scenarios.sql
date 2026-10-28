-- Behavioral schema scenarios for release A. Run only against a dedicated test
-- database. Fixtures are synthetic and keyed in the session table scope_fixture.
CREATE TEMP TABLE scope_assertion (name text PRIMARY KEY);
CREATE TEMP TABLE scope_fixture (key text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION pg_temp.fixture(p_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM scope_fixture WHERE key = p_key
$$;
CREATE FUNCTION pg_temp.reject(p_name text, p_sql text, p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_message IN SQLERRM) = 0 THEN RAISE EXCEPTION 'Unexpected error for %: %', p_name, SQLERRM; END IF;
    INSERT INTO scope_assertion VALUES (p_name);
    RETURN;
  END;
  RAISE EXCEPTION 'Expected rejection did not occur: %', p_name;
END;
$$;
-- Accept with the party's current membership epoch and capability revision.
CREATE FUNCTION pg_temp.accept(p_plan uuid, p_revision integer, p_party text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO shipment_plan_acceptance(plan_id,revision,party,organization_id,user_id,grant_id,grant_revision,
      membership_id,membership_version,capability_revision)
    SELECT p_plan,p_revision,upper(p_party)::hybrid_plan_party,m.organization_id,pg_temp.fixture(p_party||'_user'),
      g.grant_id,g.revision,m.membership_id,m.version,c.revision
    FROM shipment_plan p JOIN chain_membership m ON m.chain_id=p.chain_id AND m.organization_id=pg_temp.fixture(p_party)
    JOIN scoped_role_grant g ON g.grant_id=pg_temp.fixture(p_party||'_grant')
    JOIN organization_capability c ON c.organization_id=m.organization_id
      AND c.code=CASE p_party WHEN 'producer' THEN 'FARM'::organization_type
        WHEN 'transporter' THEN 'TRANSPORTER'::organization_type ELSE 'RETAILER'::organization_type END
    WHERE p.plan_id=p_plan
$$;
CREATE FUNCTION pg_temp.check(p_name text, p_condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', p_name; END IF;
  INSERT INTO scope_assertion VALUES (p_name);
END;
$$;

DO $$
DECLARE v_org uuid; v_chain uuid; v_farm uuid; v_product uuid; v_cycle uuid; v_harvest uuid; v_lot uuid;
  v_role uuid; v_user uuid; v_grant uuid; v_plan uuid; v_assignment uuid; v_party text;
BEGIN
  INSERT INTO app_role(code,name) VALUES ('FARM_STAFF','Schema fixture role')
    ON CONFLICT(code) DO UPDATE SET name = EXCLUDED.name RETURNING role_id INTO v_role;
  FOR v_party IN SELECT unnest(ARRAY['producer','transporter','retailer']) LOOP
    INSERT INTO organization(name,type) VALUES ('Schema fixture '||v_party,
      CASE v_party WHEN 'producer' THEN 'FARM'::organization_type WHEN 'transporter' THEN 'TRANSPORTER'::organization_type ELSE 'RETAILER'::organization_type END)
      RETURNING organization_id INTO v_org;
    INSERT INTO scope_fixture VALUES (v_party,v_org);
    INSERT INTO app_user(organization_id,role_id,email,password_hash,full_name)
      VALUES (v_org,v_role,v_party||'-'||gen_random_uuid()||'@example.test','unused-test-hash','Schema fixture') RETURNING user_id INTO v_user;
    INSERT INTO scope_fixture VALUES (v_party||'_user',v_user);
    INSERT INTO scoped_role_grant(user_id,organization_id,scope,role)
      VALUES (v_user,v_org,'ORGANIZATION','ORG_ADMIN') RETURNING grant_id INTO v_grant;
    INSERT INTO scope_fixture VALUES (v_party||'_grant',v_grant);
  END LOOP;
  FOR v_party IN SELECT unnest(ARRAY['chain_a','chain_b']) LOOP
    INSERT INTO supply_chain(owner_organization_id,name) VALUES (pg_temp.fixture('producer'),v_party) RETURNING chain_id INTO v_chain;
    INSERT INTO scope_fixture VALUES (v_party,v_chain);
    INSERT INTO chain_membership(chain_id,organization_id,status)
      SELECT v_chain,id,'ACTIVE' FROM scope_fixture WHERE key IN ('producer','transporter','retailer');
    INSERT INTO chain_business_profile(chain_id) VALUES (v_chain);
  END LOOP;
  INSERT INTO farm(organization_id,name) VALUES (pg_temp.fixture('producer'),'Schema farm') RETURNING farm_id INTO v_farm;
  INSERT INTO product(product_name,default_unit) VALUES ('Schema crop','kg') RETURNING product_id INTO v_product;
  INSERT INTO scope_fixture VALUES ('farm',v_farm),('product',v_product);
  PERFORM pg_temp.reject('profile-preparing-denies-cycle',format(
    'INSERT INTO production_cycle(cycle_code,product_id,farm_id,farm_org_id,chain_id) VALUES (%L,%L,%L,%L,%L)',
    'blocked',v_product,v_farm,pg_temp.fixture('producer'),pg_temp.fixture('chain_a')),'Hybrid business profile not active');
  UPDATE chain_business_profile SET state='ACTIVE',version=1
    WHERE chain_id IN(pg_temp.fixture('chain_a'),pg_temp.fixture('chain_b'));
  PERFORM pg_temp.reject('cycle-requires-chain',format(
    'INSERT INTO production_cycle(cycle_code,product_id,farm_id,farm_org_id) VALUES (%L,%L,%L,%L)',
    'unscoped',v_product,v_farm,pg_temp.fixture('producer')),'Cycle chain scope is required');
  INSERT INTO production_cycle(cycle_code,product_id,farm_id,farm_org_id,chain_id)
    VALUES ('scoped',v_product,v_farm,pg_temp.fixture('producer'),pg_temp.fixture('chain_a')) RETURNING cycle_id INTO v_cycle;
  INSERT INTO scope_fixture VALUES ('cycle',v_cycle);
  INSERT INTO stage_assignment(chain_id,organization_id,stage,cycle_id,status)
    VALUES (pg_temp.fixture('chain_a'),pg_temp.fixture('producer'),'PRODUCTION',v_cycle,'ACCEPTED') RETURNING assignment_id INTO v_assignment;
  INSERT INTO scope_fixture VALUES ('assignment',v_assignment);
  PERFORM pg_temp.reject('assignment-cross-chain',format(
    'INSERT INTO stage_assignment(chain_id,organization_id,stage,cycle_id) VALUES (%L,%L,%L,%L)',
    pg_temp.fixture('chain_b'),pg_temp.fixture('producer'),'PRODUCTION',v_cycle),'Assignment subject/chain/party mismatch');
  PERFORM pg_temp.reject('assignment-active-unique',format(
    'INSERT INTO stage_assignment(chain_id,organization_id,stage,cycle_id) VALUES (%L,%L,%L,%L)',
    pg_temp.fixture('chain_a'),pg_temp.fixture('producer'),'PRODUCTION',v_cycle),'uq_stage_cycle_active');
  PERFORM pg_temp.reject('assignment-party-immutable',format(
    'UPDATE stage_assignment SET organization_id=%L,version=1 WHERE assignment_id=%L',pg_temp.fixture('transporter'),v_assignment),'Assignment subject/party immutable');
  PERFORM pg_temp.reject('cycle-scope-immutable',format(
    'UPDATE production_cycle SET chain_id=%L WHERE cycle_id=%L',pg_temp.fixture('chain_b'),v_cycle),'Cycle chain scope is immutable');
  INSERT INTO harvest_event(cycle_id,harvest_time,quantity,unit) VALUES (v_cycle,now(),10,'kg') RETURNING harvest_id INTO v_harvest;
  INSERT INTO lot(lot_code,harvest_id,product_id,farm_org_id,initial_quantity,available_quantity,unit)
    VALUES ('scope-lot-'||gen_random_uuid(),v_harvest,v_product,pg_temp.fixture('producer'),10,10,'kg') RETURNING lot_id INTO v_lot;
  INSERT INTO scope_fixture VALUES ('lot',v_lot);
  PERFORM pg_temp.reject('plan-cross-chain',format('INSERT INTO shipment_plan(chain_id,lot_id) VALUES (%L,%L)',pg_temp.fixture('chain_b'),v_lot),'Plan Lot belongs to another chain');
  INSERT INTO shipment_plan(chain_id,lot_id) VALUES (pg_temp.fixture('chain_a'),v_lot) RETURNING plan_id INTO v_plan;
  INSERT INTO scope_fixture VALUES ('plan',v_plan);
  INSERT INTO shipment_plan_revision(plan_id,revision,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,payload_digest)
    VALUES (v_plan,0,pg_temp.fixture('producer'),pg_temp.fixture('transporter'),pg_temp.fixture('retailer'),10,'kg','farm','shop',repeat('a',64));
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan'); v_party text;
BEGIN
  PERFORM pg_temp.reject('accept-for-other-party',format(
    'INSERT INTO shipment_plan_acceptance(plan_id,revision,party,organization_id,user_id,grant_id,grant_revision,membership_id,membership_version,capability_revision)
       SELECT %L,0,%L,%L,%L,%L,0,m.membership_id,m.version,c.revision FROM chain_membership m JOIN organization_capability c ON c.organization_id=m.organization_id AND c.code=''FARM'' WHERE m.chain_id=%L AND m.organization_id=%L',
    v_plan,'TRANSPORTER',pg_temp.fixture('producer'),pg_temp.fixture('producer_user'),pg_temp.fixture('producer_grant'),pg_temp.fixture('chain_a'),pg_temp.fixture('producer')),'Cannot accept for another party');
  PERFORM pg_temp.reject('accept-with-other-users-grant',format(
    'INSERT INTO shipment_plan_acceptance(plan_id,revision,party,organization_id,user_id,grant_id,grant_revision,membership_id,membership_version,capability_revision)
       SELECT %L,0,%L,%L,%L,%L,0,m.membership_id,m.version,c.revision FROM chain_membership m JOIN organization_capability c ON c.organization_id=m.organization_id AND c.code=''FARM'' WHERE m.chain_id=%L AND m.organization_id=%L',
    v_plan,'PRODUCER',pg_temp.fixture('producer'),pg_temp.fixture('producer_user'),pg_temp.fixture('transporter_grant'),pg_temp.fixture('chain_a'),pg_temp.fixture('producer')),'Acceptance requires the current organization admin grant');
  PERFORM pg_temp.reject('acceptance-requires-snapshot',format(
    'INSERT INTO shipment_plan_acceptance(plan_id,revision,party,organization_id,user_id,grant_id,grant_revision) VALUES (%L,0,%L,%L,%L,%L,0)',
    v_plan,'PRODUCER',pg_temp.fixture('producer'),pg_temp.fixture('producer_user'),pg_temp.fixture('producer_grant')),'current membership and capability snapshot');
  PERFORM pg_temp.reject('acceptance-stale-membership-epoch',format(
    'INSERT INTO shipment_plan_acceptance(plan_id,revision,party,organization_id,user_id,grant_id,grant_revision,membership_id,membership_version,capability_revision)
       SELECT %L,0,%L,organization_id,%L,%L,0,membership_id,version+1,0 FROM chain_membership WHERE chain_id=%L AND organization_id=%L',
    v_plan,'PRODUCER',pg_temp.fixture('producer_user'),pg_temp.fixture('producer_grant'),pg_temp.fixture('chain_a'),pg_temp.fixture('producer')),'current membership and capability snapshot');
  FOR v_party IN SELECT unnest(ARRAY['producer','transporter','retailer']) LOOP
    PERFORM pg_temp.accept(v_plan,0,v_party);
  END LOOP;
  PERFORM pg_temp.check('acceptances-three-parties', (SELECT count(*)=3 FROM shipment_plan_acceptance WHERE plan_id=v_plan));
  PERFORM pg_temp.reject('revision-immutable',format('UPDATE shipment_plan_revision SET destination=%L WHERE plan_id=%L','forged',v_plan),'immutable');
  PERFORM pg_temp.reject('acceptance-immutable',format('DELETE FROM shipment_plan_acceptance WHERE plan_id=%L',v_plan),'immutable');
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan');
BEGIN
  INSERT INTO shipment_plan_revision(plan_id,revision,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,payload_digest)
    SELECT plan_id,1,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,'shop-v2',repeat('b',64)
      FROM shipment_plan_revision WHERE plan_id=v_plan AND revision=0;
  UPDATE shipment_plan SET current_revision=1,version=1 WHERE plan_id=v_plan;
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan'); v_shipment uuid; v_party text; v_grant uuid;
BEGIN
  INSERT INTO shipment(lot_id,transporter_org_id,retailer_org_id,origin,destination,shipped_quantity,unit)
    VALUES (pg_temp.fixture('lot'),pg_temp.fixture('transporter'),pg_temp.fixture('retailer'),'farm','shop-v2',10,'kg') RETURNING shipment_id INTO v_shipment;
  INSERT INTO scope_fixture VALUES ('shipment',v_shipment);
  PERFORM pg_temp.reject('revise-invalidates-old-acceptances',format(
    'UPDATE shipment_plan SET status=%L,shipment_id=%L,version=2 WHERE plan_id=%L','FINALIZED',v_shipment,v_plan),'Missing current party acceptance');
  PERFORM pg_temp.reject('stale-revision-acceptance-denied',format(
    'INSERT INTO shipment_plan_acceptance(plan_id,revision,party,organization_id,user_id,grant_id,grant_revision,membership_id,membership_version,capability_revision)
       SELECT %L,0,%L,%L,%L,%L,0,m.membership_id,m.version,c.revision FROM chain_membership m JOIN organization_capability c ON c.organization_id=m.organization_id AND c.code=''FARM'' WHERE m.chain_id=%L AND m.organization_id=%L',
    v_plan,'PRODUCER',pg_temp.fixture('producer'),pg_temp.fixture('producer_user'),pg_temp.fixture('producer_grant'),pg_temp.fixture('chain_a'),pg_temp.fixture('producer')),'Plan acceptance is stale');
  FOR v_party IN SELECT unnest(ARRAY['producer','transporter','retailer']) LOOP
    PERFORM pg_temp.accept(v_plan,1,v_party);
  END LOOP;
  UPDATE scoped_role_grant SET revoked_at=now(),revision=1 WHERE grant_id=pg_temp.fixture('transporter_grant');
  PERFORM pg_temp.reject('revoked-accepting-grant-blocks-finalize',format(
    'UPDATE shipment_plan SET status=%L,shipment_id=%L,version=2 WHERE plan_id=%L','FINALIZED',v_shipment,v_plan),'Accepting grant no longer valid');
  INSERT INTO scoped_role_grant(user_id,organization_id,scope,role)
    VALUES (pg_temp.fixture('transporter_user'),pg_temp.fixture('transporter'),'ORGANIZATION','ORG_ADMIN') RETURNING grant_id INTO v_grant;
  UPDATE scope_fixture SET id=v_grant WHERE key='transporter_grant';
  PERFORM pg_temp.reject('new-grant-does-not-revive-old-intent',format(
    'UPDATE shipment_plan SET status=%L,shipment_id=%L,version=2 WHERE plan_id=%L','FINALIZED',v_shipment,v_plan),'Accepting grant no longer valid');
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan');
BEGIN
  INSERT INTO shipment_plan_revision(plan_id,revision,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,payload_digest)
    SELECT plan_id,2,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,repeat('c',64)
      FROM shipment_plan_revision WHERE plan_id=v_plan AND revision=1;
  UPDATE shipment_plan SET current_revision=2,version=2 WHERE plan_id=v_plan;
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan'); v_party text;
BEGIN
  FOR v_party IN SELECT unnest(ARRAY['producer','transporter','retailer']) LOOP
    PERFORM pg_temp.accept(v_plan,2,v_party);
  END LOOP;
  -- Same ORG_ADMIN grant, but the retailer capability was revoked/regranted.
  UPDATE organization_capability SET revoked_at=now(),revision=revision+1
    WHERE organization_id=pg_temp.fixture('retailer') AND code='RETAILER';
  UPDATE organization_capability SET revoked_at=NULL,revision=revision+1
    WHERE organization_id=pg_temp.fixture('retailer') AND code='RETAILER';
  PERFORM pg_temp.reject('regranted-capability-blocks-old-consent',format(
    'UPDATE shipment_plan SET status=%L,shipment_id=%L,version=3 WHERE plan_id=%L','FINALIZED',pg_temp.fixture('shipment'),v_plan),'Accepting membership or capability changed');
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan');
BEGIN
  INSERT INTO shipment_plan_revision(plan_id,revision,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,payload_digest)
    SELECT plan_id,3,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,repeat('d',64)
      FROM shipment_plan_revision WHERE plan_id=v_plan AND revision=2;
  UPDATE shipment_plan SET current_revision=3,version=3 WHERE plan_id=v_plan;
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan');
BEGIN
  PERFORM pg_temp.accept(v_plan,3,'producer');
  PERFORM pg_temp.accept(v_plan,3,'transporter');
  PERFORM pg_temp.accept(v_plan,3,'retailer');
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan');
BEGIN
  INSERT INTO shipment_plan_revision(plan_id,revision,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,payload_digest)
    SELECT plan_id,4,producer_org_id,transporter_org_id,retailer_org_id,quantity,unit,origin,destination,repeat('e',64)
      FROM shipment_plan_revision WHERE plan_id=v_plan AND revision=3;
  UPDATE shipment_plan SET current_revision=4,version=4 WHERE plan_id=v_plan;
END;
$$;

DO $$
DECLARE v_plan uuid := pg_temp.fixture('plan'); v_party text;
BEGIN
  FOR v_party IN SELECT unnest(ARRAY['producer','transporter','retailer']) LOOP
    PERFORM pg_temp.accept(v_plan,4,v_party);
  END LOOP;
  UPDATE shipment_plan SET status='FINALIZED',shipment_id=pg_temp.fixture('shipment'),version=5 WHERE plan_id=v_plan;
  INSERT INTO stage_assignment(chain_id,organization_id,stage,shipment_id,status)
    VALUES (pg_temp.fixture('chain_a'),pg_temp.fixture('transporter'),'TRANSPORT',pg_temp.fixture('shipment'),'ACCEPTED');
  INSERT INTO stage_assignment(chain_id,organization_id,stage,lot_id,status)
    VALUES (pg_temp.fixture('chain_a'),pg_temp.fixture('retailer'),'RETAIL',pg_temp.fixture('lot'),'ACCEPTED');
  PERFORM pg_temp.check('finalize-with-current-consent', (SELECT status='FINALIZED' AND current_revision=4 FROM shipment_plan WHERE plan_id=v_plan));
  PERFORM pg_temp.check('old-consent-history-retained', (SELECT count(*)=15 FROM shipment_plan_acceptance WHERE plan_id=v_plan));
  PERFORM pg_temp.check('three-stage-assignments', (SELECT count(*)=3 FROM stage_assignment WHERE chain_id=pg_temp.fixture('chain_a')));
  PERFORM pg_temp.reject('finalized-plan-immutable',format('UPDATE shipment_plan SET current_revision=0,version=6 WHERE plan_id=%L',v_plan),'Plan scope immutable');
  PERFORM pg_temp.reject('second-shipment-for-lot-denied',format(
    'INSERT INTO shipment(lot_id,transporter_org_id,retailer_org_id,origin,destination,shipped_quantity,unit) VALUES (%L,%L,%L,%L,%L,10,%L)',
    pg_temp.fixture('lot'),pg_temp.fixture('transporter'),pg_temp.fixture('retailer'),'farm','shop-v2','kg'),'unique constraint');
  PERFORM pg_temp.reject('created-shipment-route-immutable',format(
    'UPDATE shipment SET destination=%L WHERE shipment_id=%L','forged',pg_temp.fixture('shipment')),'Shipment assignment, route');
END;
$$;

DO $$
DECLARE v_org uuid; v_farm uuid; v_member uuid;
BEGIN
  INSERT INTO organization(name,type) VALUES ('Late partner','FARM') RETURNING organization_id INTO v_org;
  INSERT INTO chain_membership(chain_id,organization_id) VALUES (pg_temp.fixture('chain_a'),v_org) RETURNING membership_id INTO v_member;
  UPDATE chain_membership SET status='ACTIVE',version=1 WHERE membership_id=v_member;
  UPDATE chain_membership SET status='REVOKED',version=2 WHERE membership_id=v_member;
  INSERT INTO farm(organization_id,name) VALUES (v_org,'Late partner farm') RETURNING farm_id INTO v_farm;
  PERFORM pg_temp.reject('revoked-member-cannot-create-cycle',format(
    'INSERT INTO production_cycle(cycle_code,product_id,farm_id,farm_org_id,chain_id) VALUES (%L,%L,%L,%L,%L)',
    'revoked',pg_temp.fixture('product'),v_farm,v_org,pg_temp.fixture('chain_a')),'Hybrid membership inactive');
  UPDATE chain_business_profile SET state='SUSPENDED',version=2 WHERE chain_id=pg_temp.fixture('chain_a');
  PERFORM pg_temp.reject('suspended-profile-denies-scoped-cycle',format(
    'INSERT INTO production_cycle(cycle_code,product_id,farm_id,farm_org_id,chain_id) VALUES (%L,%L,%L,%L,%L)',
    'suspended',pg_temp.fixture('product'),pg_temp.fixture('farm'),pg_temp.fixture('producer'),pg_temp.fixture('chain_a')),'Hybrid business profile not active');
END;
$$;

SELECT json_build_object('assertions',count(*),'cases',json_agg(name ORDER BY name)) FROM scope_assertion;
