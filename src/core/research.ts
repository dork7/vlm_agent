import type { ObjectId } from "mongodb";
import type { Database } from "../db.ts";
import type { Citation, ChatMessage, Llm, ModelAttempt } from "../llm/openrouter.ts";

/** What a Research answer drew on: the web pages it cited, and the User's own Notes and Tasks. */
export type ResearchSources = { web: Citation[]; items: ResearchItem[] };

export type ResearchItem = { kind: "note" | "task"; heading: string };

export type ResearchAnswer = { answer: string; sources: ResearchSources };

/** A Research answer, with what it took, for the Run. */
export type Researched = ResearchAnswer & { matches: number; attempts: ModelAttempt[] };

/** How many of the User's own Notes and Tasks go to the model with the question. */
const MAX_MATCHES = 5;

/** Words too common to tell one Note or Task from another. */
const COMMON_WORDS = new Set(
  (
    "a about after again all also am an and any are as at be been before but by can could did do does for from " +
    "get got had has have how i if in into is it its just me my of on or our out so than that the their them then " +
    "there these they this to up us was we were what when where which who why will with would you your " +
    "find out look search tell show know note notes noted task tasks saved save remember said wrote"
  ).split(" "),
);

/**
 * Answers the User's question from their own matching Notes and Tasks and, when `web`, the web.
 * Throws AllModelsFailedError when no model answers.
 */
export async function research(deps: {
  llm: Llm;
  database: Database;
  ownerId: ObjectId;
  question: string;
  web: boolean;
  today: { date: string; weekday: string };
}): Promise<Researched> {
  const { llm, question, web, today } = deps;
  const matches = await matchingItems(deps.database, deps.ownerId, question);
  const saved =
    matches.length === 0
      ? "None of their saved Notes or Tasks match the question."
      : "Their saved Notes and Tasks that may be relevant:\n" +
        matches.map((item) => `- ${item.kind === "note" ? "Note" : "Task"} "${item.heading}": ${item.text}`).join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You research a question for a person and reply in a short, plain-language answer they can read in a chat " +
        `message. Today is ${today.weekday} ${today.date}. ` +
        (web
          ? "Use the web search results you are given and their saved Notes and Tasks below, say which facts come from " +
            "their own Notes or Tasks, and say plainly when nothing you have answers the question."
          : "Answer only from their saved Notes and Tasks below, and say plainly when they don't answer the question.") +
        `\n\n${saved}`,
    },
    { role: "user", content: question },
  ];
  const { value, attempts } = await llm.answer({ messages, web });
  return {
    answer: value.text,
    sources: { web: value.citations, items: matches.map(({ kind, heading }) => ({ kind, heading })) },
    matches: matches.length,
    attempts,
  };
}

/** The owner's Notes and Tasks sharing the most of the question's words, best first; never another User's. */
async function matchingItems(
  database: Database,
  ownerId: ObjectId,
  question: string,
): Promise<Array<ResearchItem & { text: string }>> {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter(
    (word) => word.length > 1 && !COMMON_WORDS.has(word),
  );
  if (words.length === 0) return [];
  const [notes, tasks] = await Promise.all([
    database.notes.find({ ownerId }).toArray(),
    database.tasks.find({ ownerId }).toArray(),
  ]);
  const items = [
    ...notes.map((note) => ({ kind: "note" as const, heading: note.heading, text: note.text, at: note.updatedAt })),
    ...tasks.map((task) => ({ kind: "task" as const, heading: task.heading, text: task.description, at: task.updatedAt })),
  ];
  return items
    .map((item) => {
      const itemWords = new Set(`${item.heading} ${item.text}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
      // A question word matches an item word it begins, so "supplier" finds "suppliers".
      const score = words.filter((word) => [...itemWords].some((itemWord) => itemWord.startsWith(word))).length;
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.at.getTime() - a.at.getTime())
    .slice(0, MAX_MATCHES)
    .map(({ kind, heading, text }) => ({ kind, heading, text }));
}
