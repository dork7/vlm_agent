import type { FastifyPluginAsync } from "fastify";
import type { RunStageName, RunType } from "../core/runs.ts";
import type { Database, UserDoc } from "../db.ts";
import { formatDay, instantToWallClock } from "../time.ts";
import { notFound, parseId, render } from "./http.ts";

export type RunRoutesOptions = { database: Database; timezoneOf: (user: UserDoc) => string };

/** How many Runs the list shows. */
const RECENT_RUNS = 100;

/** How many of the latest days with messages the totals show. */
const RECENT_DAYS = 30;

/** The types counted in the totals, as people read them. */
const COUNTED_TYPES: Array<[RunType, string]> = [
  ["note", "Note"],
  ["task", "Task"],
  ["query", "Query"],
];

const STAGE_ORDER: RunStageName[] = [
  "received",
  "download",
  "conversion",
  "transcription",
  "classification",
  "tool-call",
  "query-answer",
  "reply",
];

/** The observability dashboard (ADR 0003): admins only, since Runs show every User's messages. */
export const runRoutes: FastifyPluginAsync<RunRoutesOptions> = async (app, { database, timezoneOf }) => {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.user.isAdmin) {
      return reply.code(403).type("text/plain").send("Only admins can see Runs.");
    }
  });

  /** When something happened, on the viewer's own clock. */
  const shownTime = (user: UserDoc) => (instant: Date) => {
    const { date, time } = instantToWallClock(instant, timezoneOf(user));
    return `${formatDay(date)}, ${time}`;
  };

  app.get("/runs", async (request, reply) => {
    const runs = await database.runs.find().sort({ startedAt: -1, _id: -1 }).limit(RECENT_RUNS).toArray();
    const awaiting = await database.runs.countDocuments({ status: "awaiting-clarification" });
    return render(reply, "runs", { runs, awaiting, shown: shownTime(request.user), duration: formatDuration });
  });

  app.get("/runs/totals", async (request, reply) => {
    const totals = await runTotals(database, timezoneOf(request.user));
    return render(reply, "run-totals", { ...totals, types: COUNTED_TYPES, day: formatDay, duration: formatDuration, share });
  });

  app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const id = parseId(request.params.id);
    const run = id ? await database.runs.findOne({ _id: id }) : null;
    if (!run) return notFound(reply);
    return render(reply, "run", { run, shown: shownTime(request.user), duration: formatDuration });
  });
};

/** A duration as people read it: "120 ms" under a second, "1.84 s" above. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** "20% (1 of 5)"; a share of nothing is "–". */
function share(part: number, whole: number): string {
  return whole === 0 ? "–" : `${Math.round((part / whole) * 100)}% (${part} of ${whole})`;
}

type RunTotals = {
  /** The latest days with messages, newest first; `date` is on the viewer's own clock. */
  perDay: Array<{ date: string; count: number }>;
  byType: Partial<Record<RunType, number>>;
  /** Finished Runs (not in progress), and how many of them failed. */
  finished: number;
  failed: number;
  averageStageMs: Array<{ name: RunStageName; averageMs: number }>;
  /** Runs that called a model, and how many of them had to fall back from a failed model to the next. */
  usedModel: number;
  fellBack: number;
};

async function runTotals(database: Database, timezone: string): Promise<RunTotals> {
  const { runs } = database;
  const [perDay, byType, finished, failed, stageTimes, usedModel, fellBack] = await Promise.all([
    runs
      .aggregate<{ _id: string; count: number }>([
        { $group: { _id: { $dateToString: { date: "$startedAt", format: "%Y-%m-%d", timezone } }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
        { $limit: RECENT_DAYS },
      ])
      .toArray(),
    runs.aggregate<{ _id: RunType | null; count: number }>([{ $group: { _id: "$type", count: { $sum: 1 } } }]).toArray(),
    runs.countDocuments({ status: { $ne: "in-progress" } }),
    runs.countDocuments({ status: "failed" }),
    runs
      .aggregate<{ _id: RunStageName; averageMs: number }>([
        { $unwind: "$stages" },
        { $group: { _id: "$stages.name", averageMs: { $avg: "$stages.durationMs" } } },
      ])
      .toArray(),
    runs.countDocuments({ "stages.name": { $in: ["classification", "query-answer"] } }),
    // A model stage with a second attempt means a model failed and the next in the list was tried.
    runs.countDocuments({ "stages.details.attempts.1": { $exists: true } }),
  ]);

  return {
    perDay: perDay.map(({ _id, count }) => ({ date: _id, count })),
    byType: Object.fromEntries(byType.filter(({ _id }) => _id !== null).map(({ _id, count }) => [_id, count])),
    finished,
    failed,
    averageStageMs: stageTimes
      .map(({ _id, averageMs }) => ({ name: _id, averageMs: Math.round(averageMs) }))
      .sort((a, b) => STAGE_ORDER.indexOf(a.name) - STAGE_ORDER.indexOf(b.name)),
    usedModel,
    fellBack,
  };
}
