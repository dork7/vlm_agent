// Temporary: runs the real app against an in-memory MongoDB (data is lost on exit).
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawn } from "node:child_process";

const mongo = await MongoMemoryServer.create();
const app = spawn("npx", ["tsx", "--env-file=.env", "src/main.ts"], {
  env: { ...process.env, MONGODB_URI: mongo.getUri(), ...(process.env.RUN_MODEL ? { OPENROUTER_MODELS: process.env.RUN_MODEL } : {}) },
  stdio: "inherit",
});
const stop = () => app.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", async (code) => {
  await mongo.stop();
  process.exit(code ?? 0);
});
