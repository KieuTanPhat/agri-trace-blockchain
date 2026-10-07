import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/dist/generated/prisma/client.js';
import { bootstrapUat, readAccounts } from '../apps/api/scripts/bootstrap-uat.mjs';
import { UAT_FIXTURE, UAT_ROLES } from './fixtures.mjs';

const connectionString = process.env.UAT_TEST_DATABASE_URL;
if (!connectionString || !/(_ci|_test|checks)/.test(new URL(connectionString).pathname)) {
  throw new Error('UAT_TEST_DATABASE_URL must identify a dedicated test database');
}
const database = new PrismaClient({adapter: new PrismaPg({connectionString})});
const directory = mkdtempSync(path.join(os.tmpdir(), 'agri-uat-bootstrap-test-'));
const filename = path.join(directory, 'accounts.json');
const accounts = UAT_ROLES.map(role => ({role, email: `${role.toLowerCase()}@uat.agritrace.test`, password: randomBytes(24).toString('base64url')}));
const environment = {APP_ENV: 'uat', UAT_BOOTSTRAP_ENABLED: 'true', UAT_ACCOUNTS_FILE: filename, DATABASE_URL: connectionString};
writeFileSync(filename, JSON.stringify(accounts), {mode: 0o600});

test('bootstrap refuses a production context and rejects malformed credentials without disclosing them', () => {
  assert.throws(() => readAccounts({...environment, APP_ENV: 'production'}), /explicit enablement/);
  assert.throws(() => readAccounts({...environment, UAT_BOOTSTRAP_ENABLED: 'false'}), /explicit enablement/);
  writeFileSync(filename, JSON.stringify([...accounts.slice(0, 4), accounts[0]]));
  assert.throws(() => readAccounts(environment), /duplicate/i);
  writeFileSync(filename, '{ private credential');
  assert.throws(() => readAccounts(environment), /^Error: Cannot read the UAT accounts file$/);
  writeFileSync(filename, JSON.stringify(accounts));
});

test('a late fixture collision rolls back accounts and organizations and keeps existing data', async () => {
  const organization = await database.organization.create({data: {name: 'Existing copy test', type: 'FARM'}});
  await database.farm.create({data: {id: UAT_FIXTURE.farmId, organizationId: organization.id, name: 'Existing copy farm'}});
  const beforeUsers = await database.user.count();
  const beforeOrgs = await database.organization.count();
  await assert.rejects(bootstrapUat(database, readAccounts(environment)), /farm identifier conflicts/);
  assert.equal(await database.user.count(), beforeUsers);
  assert.equal(await database.organization.count(), beforeOrgs);
  assert.equal((await database.farm.findUnique({where: {id: UAT_FIXTURE.farmId}})).name, 'Existing copy farm');
  await database.farm.delete({where: {id: UAT_FIXTURE.farmId}});
  await database.organization.delete({where: {id: organization.id}});
});

test('bootstrap adds all five roles to existing data, hashes credentials and preserves accounts on replay', async () => {
  const role = await database.role.upsert({where: {code: 'SYSTEM_ADMIN'}, create: {code: 'SYSTEM_ADMIN', name: 'Existing administrator role'}, update: {}});
  const existing = await database.user.create({data: {email: `copy-${randomUUID()}@example.test`, fullName: 'Existing copy user', passwordHash: await hash(randomBytes(16).toString('hex'), 4), roleId: role.id}});
  const beforeUsers = await database.user.count();
  const first = await bootstrapUat(database, readAccounts(environment));
  assert.equal(first.created, 5);
  assert.equal(await database.user.count(), beforeUsers + 5);
  const loaded = await database.user.findMany({where: {email: {in: accounts.map(account => account.email)}}, include: {role: true}});
  assert.equal(loaded.length, 5);
  for (const account of loaded) {
    assert.ok(account.passwordHash.startsWith('$2b$12$'));
    assert.equal(account.organizationId, UAT_FIXTURE.organizations[account.role.code]?.id ?? null);
  }
  const fingerprints = loaded.map(account => `${account.id}:${account.passwordHash}`).sort();
  const second = await bootstrapUat(database, readAccounts(environment));
  assert.equal(second.created, 0);
  assert.equal(second.existing, 5);
  const replayed = await database.user.findMany({where: {email: {in: accounts.map(account => account.email)}}});
  assert.ok(JSON.stringify(replayed.map(account => `${account.id}:${account.passwordHash}`).sort()) === JSON.stringify(fingerprints));
  assert.ok((await database.user.findUnique({where: {id: existing.id}})).passwordHash === existing.passwordHash);
  assert.equal((await database.role.findUnique({where: {code: 'SYSTEM_ADMIN'}})).name, role.name);
  const changedAccounts = accounts.map(account => ({...account}));
  changedAccounts[0].password = randomBytes(24).toString('base64url');
  await assert.rejects(bootstrapUat(database, changedAccounts), /no account has been overwritten/);
  assert.equal(await database.user.count(), beforeUsers + 5);
  assert.ok(!readFileSync(filename, 'utf8').includes('SSH'));
});

test.after(async () => {
  await database.$disconnect();
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('agri-uat-bootstrap-test-')) {
    throw new Error('Refusing cleanup outside the dedicated test directory');
  }
  rmSync(resolved, {recursive: true, force: true});
});
