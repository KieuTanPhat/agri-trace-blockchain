import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hash, compare } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { UAT_ROLES, UAT_FIXTURE } from '../../../deploy/fixtures.mjs';

export function readAccounts(environment = process.env) {
  if (environment.APP_ENV !== 'uat' || environment.UAT_BOOTSTRAP_ENABLED !== 'true') {
    throw new Error('UAT bootstrap requires APP_ENV=uat and explicit enablement');
  }
  if (!environment.DATABASE_URL || !environment.UAT_ACCOUNTS_FILE) {
    throw new Error('UAT bootstrap configuration is incomplete');
  }
  let accounts;
  try { accounts = JSON.parse(readFileSync(environment.UAT_ACCOUNTS_FILE, 'utf8')); }
  catch { throw new Error('Cannot read the UAT accounts file'); }
  if (!Array.isArray(accounts) || accounts.length !== UAT_ROLES.length) {
    throw new Error('Exactly one account for each UAT role is required');
  }
  const roles = new Set();
  const emails = new Set();
  for (const account of accounts) {
    if (!UAT_ROLES.includes(account.role) || roles.has(account.role) ||
        typeof account.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) ||
        typeof account.password !== 'string' || account.password.length < 12 ||
        Buffer.byteLength(account.password) > 72) {
      throw new Error('Invalid or duplicate UAT account configuration');
    }
    account.email = account.email.trim().toLowerCase();
    if (emails.has(account.email)) throw new Error('Duplicate UAT email');
    emails.add(account.email);
    roles.add(account.role);
  }
  return accounts;
}

export async function bootstrapUat(database, accounts) {
  return database.$transaction(async tx => {
    const result = {created: 0, existing: 0, roles: UAT_ROLES, fixture: UAT_FIXTURE};
    for (const account of accounts) {
      const role = await tx.role.upsert({where: {code: account.role}, create: {code: account.role, name: account.role}, update: {}});
      const organization = UAT_FIXTURE.organizations[account.role];
      if (organization) {
        const current = await tx.organization.findUnique({where: {id: organization.id}});
        if (current && (current.name !== organization.name || current.type !== organization.type)) {
          throw new Error('UAT organization identifier conflicts with existing data');
        }
        if (!current) await tx.organization.create({data: organization});
      }
      const existing = await tx.user.findFirst({where: {email: account.email}});
      if (existing) {
        if (existing.roleId !== role.id || existing.organizationId !== (organization?.id ?? null) ||
            !(await compare(account.password, existing.passwordHash))) {
          throw new Error('Existing UAT account does not match; no account has been overwritten');
        }
        result.existing++;
      } else {
        await tx.user.create({data: {
          email: account.email, fullName: `UAT ${account.role}`,
          passwordHash: await hash(account.password, 12), roleId: role.id,
          organizationId: organization?.id ?? null,
        }});
        result.created++;
      }
    }
    const farm = await tx.farm.findUnique({where: {id: UAT_FIXTURE.farmId}});
    if (farm && (farm.organizationId !== UAT_FIXTURE.organizations.FARM_STAFF.id || farm.name !== 'UAT: Farm')) {
      throw new Error('UAT farm identifier conflicts with existing data');
    }
    if (!farm) await tx.farm.create({data: {id: UAT_FIXTURE.farmId, organizationId: UAT_FIXTURE.organizations.FARM_STAFF.id, name: 'UAT: Farm'}});
    const product = await tx.product.findUnique({where: {id: UAT_FIXTURE.productId}});
    if (product && (product.productName !== 'UAT: Vegetables' || product.defaultUnit !== 'kg')) {
      throw new Error('UAT product identifier conflicts with existing data');
    }
    if (!product) await tx.product.create({data: {id: UAT_FIXTURE.productId, productName: 'UAT: Vegetables', defaultUnit: 'kg'}});
    const plot = await tx.plot.findUnique({where: {id: UAT_FIXTURE.plotId}});
    if (plot && (plot.farmId !== UAT_FIXTURE.farmId || plot.name !== 'UAT: Plot')) {
      throw new Error('UAT plot identifier conflicts with existing data');
    }
    if (!plot) await tx.plot.create({data: {id: UAT_FIXTURE.plotId, farmId: UAT_FIXTURE.farmId, name: 'UAT: Plot', area: 1, unit: 'ha'}});
    return result;
  }, {timeout: 30_000});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let database;
  try {
    const accounts = readAccounts();
    database = new PrismaClient({adapter: new PrismaPg({connectionString: process.env.DATABASE_URL})});
    console.log(JSON.stringify(await bootstrapUat(database, accounts)));
  } catch {
    // Drivers may attach queries or credentials to errors. Keep CLI output safe.
    console.error('UAT bootstrap failed; existing data was not overwritten. Check the guard, accounts and fixture collisions.');
    process.exitCode = 1;
  } finally { await database?.$disconnect(); }
}
