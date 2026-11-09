import type { ObjectId } from "mongodb";
import type { Database } from "../db.ts";
import type { Citation, ChatMessage, Llm, ModelAttempt } from "../llm/openrouter.ts";

/** What the User asked to find out, and whether that needs the web or only their own Notes and Tasks. */
export type ResearchRequest = { question: string; web: boolean };

/** One of the User's own Notes or Tasks, as a Research answer names it. */
export type ResearchItem = { kind: "note" | "task"; heading: string };

/** What a Research answer drew on: the web pages it cited, and the User's own Notes and Tasks it used. */
export type ResearchSources = { web: Citation[]; items: ResearchItem[] };

/**
 * How Research went, for the reply and the Run: `answer` is null when the question was only about the User's own
 * items and none matched, so no model was asked. `matches` are the items given to the model; `sources.items` are
 * those its answer used.
 */
export type ResearchOutcome = {
  answer: string | null;
  sources: ResearchSources;
  matches: ResearchItem[];
  attempts: ModelAttempt[];
};

/** How many of the User's own Notes and Tasks go to the model with the question. */
const MAX_MATCHES = 5;

/** How many web pages a Research answer lists as its sources. */
const MAX_WEB_SOURCES = 5;

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
 * Throws AllModelsFailedError, carrying every attempt, when no model answers.
 */
export async function research(deps: {
  llm: Llm;
  database: Database;
  ownerId: ObjectId;
  request: ResearchRequest;
  today: { date: string; weekday: string };
}): Promise<ResearchOutcome> {
  const { llm, today } = deps;
  const { question, web } = deps.request;
  const found = await matchingItems(deps.database, deps.ownerId, question);
  const matches = found.map(({ kind, heading }) => ({ kind, heading }));
  if (!web && found.length === 0) return { answer: null, sources: { web: [], items: [] }, matches, attempts: [] };

  const saved =
    found.length === 0
      ? "None of their saved Notes or Tasks match the question."
      : "Their saved Notes and Tasks that may be relevant, numbered:\n" +
        found
          .map((item, index) => `[${index + 1}] ${item.kind === "note" ? "Note" : "Task"} "${item.heading}": ${item.text}`)
          .join("\n") +
        "\nWhen you use one of them, put its number in square brackets, such as [2], straight after what it told you.";
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You research a question for a person and reply in a short, plain-language answer they can read in a chat " +
        `message. Today is ${today.weekday} ${today.date}. ` +
        (web
          ? "Use the web search results you are given and their saved Notes and Tasks below, " +
            "and say plainly when nothing you have answers the question."
          : "Answer only from their saved Notes and Tasks below, and say plainly when they don't answer the question.") +
        `\n\n${saved}`,
    },
    { role: "user", content: question },
  ];
  const { value, attempts } = await llm.answer({ messages, web });
  const { text, used } = readItemMarkers(value.text, found.length);
  return {
    answer: text,
    sources: { web: value.citations.slice(0, MAX_WEB_SOURCES), items: used.map((index) => matches[index]!) },
    matches,
    attempts,
  };
}

/**
 * The answer without its "[n]" markers for the numbered saved items, and which of those items (as 0-based indexes,
 * in the order first cited) it used. A number outside 1..`count`, or a markdown link such as "[1](url)", is left as is.
 */
function readItemMarkers(answer: string, count: number): { text: string; used: number[] } {
  const used: number[] = [];
  const text = answer
    .replace(/\s*\[(\d+)\](?!\()/g, (marker, digits: string) => {
      const index = Number(digits) - 1;
      if (index < 0 || index >= count) return marker;
      if (!used.includes(index)) used.push(index);
      return "";
    })
    .trim();
  return { text, used };
}

/** The owner's Notes and Tasks sharing the most of the question's words, best first; never another User's. */
async function matchingItems(
  database: Database,
  ownerId: ObjectId,
  question: string,
): Promise<Array<ResearchItem & { text: string }>> {
  const asked = [...new Set(wordsOf(question))].filter((word) => word.length > 1 && !COMMON_WORDS.has(word));
  if (asked.length === 0) return [];
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
      const itemWords = wordsOf(`${item.heading} ${item.text}`);
      // A question word matches an item word it begins, so "supplier" finds "suppliers".
      const score = asked.filter((word) => itemWords.some((itemWord) => itemWord.startsWith(word))).length;
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.at.getTime() - a.at.getTime())
    .slice(0, MAX_MATCHES)
    .map(({ kind, heading, text }) => ({ kind, heading, text }));
}

/** The text's words, lower-cased, in any script. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
