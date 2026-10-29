import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll } from "vitest";
import { connectDatabase, type Database } from "../../src/db.ts";

/** A real in-memory MongoDB for the current test file, emptied after each test. */
export function useMemoryMongo(): () => Database {
  let server: MongoMemoryServer;
  let database: Database;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    database = await connectDatabase(server.getUri(), "test");
  });

  afterEach(async () => {
    await database.db.dropDatabase();
  });

  afterAll(async () => {
    await database?.close();
    await server?.stop();
  });

  return () => database;
}
