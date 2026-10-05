import { defineConfig } from 'prisma/config';

// Used only by migrate diff --from-empty --to-schema --script.
// Prisma 7 requires a datasource even for offline datamodel diff. This inert
// URL is not a real credential; --from-empty --to-schema never connects to it.
// No dotenv import, migration execution or seed command is configured.
export default defineConfig({
  schema: '../../apps/api/prisma/schema.prisma',
  datasource: { url: 'postgresql://graphify:graphify@127.0.0.1:1/analysis_only' },
});
