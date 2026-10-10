import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("PostgreSQL identity migration integration", () => {
  const client = testDatabaseUrl ? postgres(testDatabaseUrl, { max: 1, prepare: false }) : null;
  const database = client ? drizzle(client) : null;

  beforeAll(async () => {
    await migrate(database!, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await client?.end();
  });

  it("applies all seven tables and required referential constraints", async () => {
    const rows = await client!.unsafe(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'accounts', 'sessions', 'verification_tokens', 'companies', 'company_memberships', 'company_invitations')
      ORDER BY table_name
    `);
    expect(rows.map((row) => row.table_name)).toEqual([
      "accounts", "companies", "company_invitations", "company_memberships", "sessions", "users", "verification_tokens",
    ]);

    const foreignKeys = await client!.unsafe(`
      SELECT kcu.table_name, kcu.column_name,
        ccu.table_name AS referenced_table_name,
        ccu.column_name AS referenced_column_name
      FROM information_schema.key_column_usage AS kcu
      INNER JOIN information_schema.table_constraints AS tc
        ON tc.constraint_catalog = kcu.constraint_catalog
        AND tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
        AND tc.table_name = kcu.table_name
      INNER JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_catalog = kcu.constraint_catalog
        AND ccu.constraint_schema = kcu.constraint_schema
        AND ccu.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND kcu.table_schema = 'public'
        AND kcu.table_name IN ('accounts', 'sessions', 'company_memberships', 'company_invitations')
      ORDER BY kcu.table_name, kcu.column_name
    `);
    expect(foreignKeys).toEqual([
      { table_name: "accounts", column_name: "user_id", referenced_table_name: "users", referenced_column_name: "id" },
      { table_name: "company_invitations", column_name: "company_id", referenced_table_name: "companies", referenced_column_name: "id" },
      { table_name: "company_invitations", column_name: "invited_by_user_id", referenced_table_name: "users", referenced_column_name: "id" },
      { table_name: "company_memberships", column_name: "company_id", referenced_table_name: "companies", referenced_column_name: "id" },
      { table_name: "company_memberships", column_name: "user_id", referenced_table_name: "users", referenced_column_name: "id" },
      { table_name: "sessions", column_name: "user_id", referenced_table_name: "users", referenced_column_name: "id" },
    ]);
  });
});
