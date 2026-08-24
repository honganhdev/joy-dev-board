import { defineConfig } from 'drizzle-kit';

/**
 * Schema/migration tooling only. The runtime opens the database itself (see
 * `src/db/client.ts`) and applies whatever is in `drizzle/` on startup, so no
 * database credentials are needed here.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
