import { Elysia } from "elysia";

import { getDb } from "../db/client";
export const db = getDb();

export function createDbPlugin() {
  return new Elysia({ name: "db" }).decorate("db", db);
}

