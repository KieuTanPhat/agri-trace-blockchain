import { beforeAll } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  fixtureRoutePins,
  registerFixtureRoute,
} from './ledger-route-fixture.js';

fixtureRoutePins();
beforeAll(async () => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }),
  });
  try {
    await registerFixtureRoute(db);
  } finally {
    await db.$disconnect();
  }
});
