import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL ?? "postgres://disabled:disabled@127.0.0.1:1/disabled";
const client = postgres(connectionString, { max: 5, prepare: false, connect_timeout: 5 });

export const db = drizzle(client, { schema });
export { client as dbClient };

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
