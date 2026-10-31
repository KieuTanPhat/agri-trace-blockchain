import { describe, it, expect } from 'vitest';
import {
  assertDemoCatalogTarget,
  createDemoCatalog,
} from '../../prisma/demo-catalog.js';

describe('Isolated broad catalog', () => {
  it('has 30 distinct enterprises and 100 owned products without claiming evidence or active admission', () => {
    const catalog = createDemoCatalog();
    expect(catalog).toEqual(createDemoCatalog());
    expect(catalog.organizations).toHaveLength(30);
    expect(catalog.products).toHaveLength(100);
    expect(new Set(catalog.organizations.map((o) => o.type)).size).toBe(5);
    expect(
      new Set([...catalog.organizations, ...catalog.products].map((o) => o.id))
        .size,
    ).toBe(130);
    for (const p of catalog.products) {
      expect(catalog.organizations.some((o) => o.id === p.organizationId)).toBe(
        true,
      );
      expect(p.evidenceComplete).toBe(false);
      expect(p.status).toBe('INACTIVE');
    }
  });
  it('accepts only an explicitly named local test database', () => {
    const url = 'postgresql://fixture@127.0.0.1/agritrace_demo_catalog_test';
    const env = {
      NODE_ENV: 'test',
      DATABASE_URL: url,
      TEST_DATABASE_URL: url,
      AGRI_DEMO_SEED_CONFIRM: 'agritrace_demo_catalog_test',
    };
    expect(assertDemoCatalogTarget(env)).toBe('agritrace_demo_catalog_test');
    for (const change of [
      { NODE_ENV: 'production' },
      { TEST_DATABASE_URL: undefined },
      { AGRI_DEMO_SEED_CONFIRM: 'another_database' },
      {
        DATABASE_URL:
          'postgresql://fixture@remote.example/agritrace_demo_catalog_test',
        TEST_DATABASE_URL:
          'postgresql://fixture@remote.example/agritrace_demo_catalog_test',
      },
    ])
      expect(() => assertDemoCatalogTarget({ ...env, ...change })).toThrow();
  });
});
