import { writeFile } from "node:fs/promises";
import type { RouteHandlerMethod } from "fastify";
import { Bot, InlineKeyboard, webhookCallback, type BotConfig, type Context } from "grammy";
import type {
  ChangeAction,
  ClarificationOption,
  Core,
  CoreEvent,
  Due,
  EventSource,
  InboundMessage,
  ListedNote,
  ListedTask,
  ReminderEvent,
  ResearchSources,
  ShownItem,
} from "../core/core.ts";
import { formatDay } from "../time.ts";

const PROCESSING = "processing…";
const REFUSAL = "Sorry, you're not allowed to use this bot. Please ask its owner for access.";
const FAILURE = "Sorry, I couldn't process that. Please try again.";
const VOICE_TOO_LONG = (maxSeconds: number) =>
  `Sorry, that Voice Message is over ${maxSeconds / 60} minutes. Please split it into shorter ones.`;
const COMMAND_DECLINED = "Sorry, changing Inventory data isn't supported yet. You can ask me about it instead.";
const CLARIFICATION_QUESTION = "I couldn't tell what this is. Is it a Note, a Task or a Query about the Inventory?";
const OPTION_LABELS: Record<ClarificationOption, string> = { note: "Note", task: "Task", query: "Query" };
/** A tapped Clarification button's data: `clarify:<Clarification ID>:<option>`, well under Telegram's 64 bytes. */
const CLARIFICATION_BUTTON = /^clarify:([0-9a-f]{24}):(note|task|query)$/;
/** A tapped Reminder "Done" button's data: `done:<Task ID>`. */
const DONE_BUTTON = /^done:([0-9a-f]{24})$/;
const TASK_NOT_FOUND = "Sorry, I couldn't find that Task. It may have been deleted.";
/** A tapped Confirm or Cancel button under a proposed change: `change:<change ID>:yes|no`. */
const CHANGE_BUTTON = /^change:([0-9a-f]{24}):(yes|no)$/;
const ITEM_NOT_FOUND = "Sorry, I couldn't find that Note or Task, so nothing was changed.";
const CHANGE_CANCELLED = "Cancelled. Nothing was changed.";
const ITEM_LABELS: Record<ShownItem["kind"], string> = { note: "Note", task: "Task" };
const CHANGE_QUESTIONS: Record<ChangeAction, (item: string) => string> = {
  edit: (item) => `Change this ${item}?`,
  done: (item) => `Mark this ${item} done?`,
  reopen: (item) => `Reopen this ${item}?`,
  delete: (item) => `Delete this ${item}?`,
};
const CHANGE_DONE: Record<ChangeAction, (item: string, heading: string) => string> = {
  edit: (item, heading) => `Updated ${item}: ${heading}`,
  done: (_item, heading) => `Marked done: ${heading}`,
  reopen: (_item, heading) => `Reopened: ${heading}`,
  delete: (item, heading) => `Deleted ${item}: ${heading}`,
};
const PROCESSED_BY: Record<EventSource["processedBy"], string> = {
  openrouter: "Processed by OpenRouter",
  local: "Processed by local AI",
};
const NOTHING_FOUND = "I couldn't find anything about that in your Notes or Tasks.";
/** Room for one page of a reply under Telegram's 4096-character message limit, leaving space for the source line. */
const PAGE_LIMIT = 4000;
const GREETING = "Hi! Send me a message or a Voice Message to save a Note or Task, or to research something. What would you like to do?";
/** What each button under the greeting asks the User to send next. */
const HINTS = {
  note: 'Send me the Note, typed or as a Voice Message, e.g. "Ahmed at Gulf Packaging is on extension 214".',
  task: 'Send me the Task, with when it\'s due if it has a time, e.g. "call the supplier Thursday at 3".',
  research: 'Tell me what to find out, e.g. "find out the VAT rate on exports". I\'ll look on the web and in your Notes and Tasks.',
  other:
    "Tell me what you need, typed or as a Voice Message, and I'll work out the rest. Type options to see every option. " +
    'I can also show your Tasks or Notes ("what\'s due tomorrow?"), change or delete one, or answer Inventory questions.',
};
/** A tapped greeting button's data: `hint:<what the User wants to do>`. */
const HINT_BUTTON = /^hint:(note|task|research|other)$/;
const greetingButtons = () =>
  new InlineKeyboard()
    .text("Add Note", "hint:note")
    .text("Add Task", "hint:task")
    .row()
    .text("Research", "hint:research")
    .text("Something else", "hint:other");
/** Typing "options", or /options, shows every option as a button; nothing is filed. */
const OPTIONS_REQUEST = /^\s*options\s*$/i;
const OPTIONS_QUESTION = "What would you like to do?";
const optionsButtons = () =>
  new InlineKeyboard()
    .text("Add Note", "hint:note")
    .text("Add Task", "hint:task")
    .row()
    .text("Show Tasks", "list:tasks")
    .text("Show Notes", "list:notes")
    .row()
    .text("Research", "hint:research")
    .text("Something else", "hint:other");
/** A tapped Show Tasks or Show Notes button's data: `list:tasks|notes`. */
const LIST_BUTTON = /^list:(tasks|notes)$/;

/** The Telegram Channel: turns updates into inbound messages and core events into Telegram calls. */
export function createTelegramBot(token: string, core: Core, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  bot.command("start", (ctx) => ctx.reply(GREETING, { reply_markup: greetingButtons() }));
  bot.command("options", (ctx) => ctx.reply(OPTIONS_QUESTION, { reply_markup: optionsButtons() }));
  bot.hears(OPTIONS_REQUEST, (ctx) => ctx.reply(OPTIONS_QUESTION, { reply_markup: optionsButtons() }));
  // Other bot commands are not messages to file.
  bot.on("message:text").filter((ctx) => !ctx.entities("bot_command").some((e) => e.offset === 0), (ctx) => {
    // Acknowledge the update straight away and process the message in the background.
    void handleMessage(ctx, core, { messageId: ctx.message.message_id, content: { kind: "text", text: ctx.message.text } });
  });
  bot.on("message:voice", (ctx) => {
    const { file_id, duration } = ctx.message.voice;
    void handleMessage(ctx, core, {
      messageId: ctx.message.message_id,
      content: { kind: "voice", durationSeconds: duration, download: (toPath) => downloadFile(ctx, file_id, toPath) },
    });
  });
  bot.callbackQuery(CLARIFICATION_BUTTON, (ctx) => {
    const [, clarificationId, answer] = ctx.match as [string, string, ClarificationOption];
    void ctx.answerCallbackQuery().catch((error) => console.error("Failed to answer a button tap", error));
    void handleMessage(ctx, core, {
      messageId: `callback:${ctx.callbackQuery.id}`,
      content: { kind: "clarification-answer", clarificationId, answer },
      // The question's message is edited into the result.
      replyId: ctx.callbackQuery.message?.message_id,
    });
  });

  bot.callbackQuery(CHANGE_BUTTON, (ctx) => {
    const [, changeId, answer] = ctx.match as [string, string, "yes" | "no"];
    void ctx.answerCallbackQuery().catch((error) => console.error("Failed to answer a button tap", error));
    void handleMessage(ctx, core, {
      messageId: `callback:${ctx.callbackQuery.id}`,
      content: { kind: "change-answer", changeId, confirm: answer === "yes" },
      // The question's message is edited into the result.
      replyId: ctx.callbackQuery.message?.message_id,
    });
  });

  // A hint is a new message, so the greeting keeps its buttons.
  bot.callbackQuery(HINT_BUTTON, async (ctx) => {
    const [, wanted] = ctx.match as [string, keyof typeof HINTS];
    void ctx.answerCallbackQuery().catch((error) => console.error("Failed to answer a button tap", error));
    await ctx.reply(HINTS[wanted]);
  });

  // The list is a new message, so the options keep their buttons.
  bot.callbackQuery(LIST_BUTTON, (ctx) => {
    const [, what] = ctx.match as [string, "tasks" | "notes"];
    void ctx.answerCallbackQuery().catch((error) => console.error("Failed to answer a button tap", error));
    void handleMessage(ctx, core, { messageId: `callback:${ctx.callbackQuery.id}`, content: { kind: "list", what } });
  });

  bot.callbackQuery(DONE_BUTTON, (ctx) => {
    const [, taskId] = ctx.match as [string, string];
    void ctx.answerCallbackQuery().catch((error) => console.error("Failed to answer a button tap", error));
    void completeTask(ctx, core, taskId);
  });

  bot.catch((error) => console.error("Telegram update failed", error.error));

  return bot;
}

/** Sends a Reminder to its Telegram Channel Identity, with a "Done" button that marks the Task done. */
export async function sendTelegramReminder(bot: Bot, reminder: ReminderEvent): Promise<void> {
  await bot.api.sendMessage(reminder.to.channelId, `Reminder: ${reminder.heading}${formatDue(reminder.due)}`, {
    reply_markup: new InlineKeyboard().text("Done", `done:${reminder.taskId}`),
  });
}

/** Marks the Task done in the background and edits the Reminder, dropping its button, to say so. */
async function completeTask(ctx: Context, core: Core, taskId: string) {
  const show = (text: string) => ctx.editMessageText(text);
  try {
    const result = await core.completeTask({ channel: "telegram", channelId: String(ctx.from!.id) }, taskId);
    await show(result.kind === "task-done" ? `Done: ${result.heading}` : TASK_NOT_FOUND);
  } catch (error) {
    console.error("Failed to mark a Task done from Telegram", error);
    await show(FAILURE).catch((replyError) => console.error("Failed to send failure reply", replyError));
  }
}

/**
 * The webhook route's handler; a wrong or missing secret gets 401. grammY answers Telegram once the
 * update's handlers return, and the message handlers above only start the work in the background,
 * so the answer is immediate. Keep it that way: awaiting the core there would hold Telegram up.
 */
export function telegramWebhookHandler(bot: Bot, secretToken: string): RouteHandlerMethod {
  return webhookCallback(bot, "fastify", { secretToken });
}

async function handleMessage(
  ctx: Context,
  core: Core,
  inbound: { messageId: number | string; content: InboundMessage["content"]; replyId?: number | undefined },
) {
  const message: InboundMessage = {
    sender: { channel: "telegram", channelId: String(ctx.from!.id) },
    chatId: String(ctx.chat!.id),
    messageId: String(inbound.messageId),
    content: inbound.content,
    clarifyWith: "buttons",
  };

  // The bot's reply being edited: the processing reply, or the Clarification whose button was tapped.
  let replyId = inbound.replyId;
  // Edit that reply when there is one, otherwise send a new message.
  const show = async (text: string, buttons?: InlineKeyboard) => {
    const extra = buttons ? { reply_markup: buttons } : {};
    if (replyId === undefined) await ctx.reply(text, extra);
    else await ctx.api.editMessageText(ctx.chat!.id, replyId, text, extra);
  };

  const render = async (event: CoreEvent, source?: EventSource) => {
    if (event.type === "processing-started") {
      if (replyId === undefined) replyId = (await ctx.reply(PROCESSING)).message_id;
      else await show(PROCESSING);
      return;
    }
    // The reply ends by saying which side's model processed the message; a failure says nothing about it.
    const signed = (text: string) => (source ? `${text}\n\n${processedBy(source)}` : text);
    if (event.type === "clarification-needed") {
      const buttons = new InlineKeyboard();
      for (const option of event.options) buttons.text(OPTION_LABELS[option], `clarify:${event.clarificationId}:${option}`);
      return show(signed(CLARIFICATION_QUESTION), buttons);
    }
    if (event.type === "change-proposed") {
      const buttons = new InlineKeyboard()
        .text(event.action === "delete" ? "Delete" : "Confirm", `change:${event.changeId}:yes`)
        .text("Cancel", `change:${event.changeId}:no`);
      return show(signed(formatChange(event.action, event.before, event.after)), buttons);
    }
    if (event.type === "result" && event.result.kind === "greeted") return show(signed(GREETING), greetingButtons());
    // A reply too long for one Telegram message continues in new ones; the source goes at the very end.
    const pages = resultPages(event.result);
    const last = pages.length - 1;
    if (event.result.kind !== "error") pages[last] = signed(pages[last]!);
    await show(pages[0]!);
    for (const page of pages.slice(1)) await ctx.reply(page);
  };

  try {
    await core.handleMessage(message, render);
  } catch (error) {
    console.error("Failed to process Telegram message", error);
    await show(FAILURE).catch((replyError) => console.error("Failed to send failure reply", replyError));
  }
}

/** "Processed by OpenRouter (model)"; just the side when the model's name is unknown. */
function processedBy(source: EventSource): string {
  return source.model ? `${PROCESSED_BY[source.processedBy]} (${source.model})` : PROCESSED_BY[source.processedBy];
}

/** The reply's text, as one Telegram message per page; only a Notes list can need more than one. */
function resultPages(result: Extract<CoreEvent, { type: "result" }>["result"]): string[] {
  return result.kind === "notes-listed" ? formatNoteList(result.notes) : [resultText(result)];
}

function resultText(result: Exclude<Extract<CoreEvent, { type: "result" }>["result"], { kind: "notes-listed" }>): string {
  switch (result.kind) {
    case "note-saved":
      return `Saved Note: ${result.heading}`;
    case "task-saved":
      return `Saved Task: ${result.heading}${formatDue(result.due)}`;
    case "tasks-listed":
      return formatTaskList(result.tasks, result.more, result.date);
    case "query-answered":
      return result.answer;
    case "researched":
      return formatResearch(result.answer, result.sources);
    case "nothing-found":
      return NOTHING_FOUND;
    case "command-declined":
      return COMMAND_DECLINED;
    case "greeted":
      return GREETING;
    case "change-applied":
      return CHANGE_DONE[result.action](ITEM_LABELS[result.itemKind], result.heading);
    case "change-cancelled":
      return CHANGE_CANCELLED;
    case "item-not-found":
      return ITEM_NOT_FOUND;
    case "voice-too-long":
      return VOICE_TOO_LONG(result.maxSeconds);
    case "refused":
      return REFUSAL;
    case "error":
      return FAILURE;
  }
}

/** A proposed change: the item now and, unless it would be deleted, after. */
function formatChange(action: ChangeAction, before: ShownItem, after: ShownItem | null): string {
  const question = CHANGE_QUESTIONS[action](ITEM_LABELS[before.kind]);
  if (after === null) return `${question}\n\n${formatItem(before)}`;
  return `${question}\n\nNow:\n${formatItem(before)}\n\nAfter:\n${formatItem(after)}`;
}

function formatItem(item: ShownItem): string {
  if (item.kind === "note") return `${item.heading}\n${item.text}`;
  return `${item.status === "done" ? "✓ " : ""}${item.heading}${formatDue(item.due)}${item.status === "done" ? " (done)" : ""}\n${item.description}`;
}

/** Fetches a file the User sent from Telegram's file storage. */
async function downloadFile(ctx: Context, fileId: string, toPath: string) {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error(`Telegram gave no path for file ${fileId}`);
  const response = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Telegram file download responded ${response.status}`);
  await writeFile(toPath, Buffer.from(await response.arrayBuffer()));
}

/** E.g. " (due Thu 29 Oct 2026, 15:00)", or "" when there is no due date. */
function formatDue(due: Due): string {
  if (due === null) return "";
  return ` (due ${formatDay(due.date)}${due.time ? `, ${due.time}` : ""})`;
}

/** Each Note's heading and text, packed into pages that leave room under Telegram's 4096-character limit for the source line. */
function formatNoteList(notes: ListedNote[]): string[] {
  if (notes.length === 0) return ["You have no Notes yet."];
  const blocks = notes.flatMap((note, index) => {
    const block = `${index + 1}. ${note.heading}\n${note.text}`;
    // A Note longer than a whole page is cut across pages.
    const pieces = [];
    for (let start = 0; start < block.length; start += PAGE_LIMIT) pieces.push(block.slice(start, start + PAGE_LIMIT));
    return pieces;
  });
  const pages = ["Your Notes:"];
  for (const block of blocks) {
    const current = pages.at(-1)!;
    if (current.length + 2 + block.length <= PAGE_LIMIT) pages[pages.length - 1] = `${current}\n\n${block}`;
    else pages.push(block);
  }
  return pages;
}

/**
 * The answer, then its sources, as one page. A long answer is cut to leave room for the sources; sources that still
 * don't fit are left out whole, so no link or Heading is ever cut short.
 */
function formatResearch(answer: string, sources: ResearchSources): string {
  const lines = [
    ...sources.web.map((page) => (page.title === page.url ? `• ${page.url}` : `• ${page.title}: ${page.url}`)),
    ...sources.items.map((item) => `• Your ${ITEM_LABELS[item.kind]}: ${item.heading}`),
  ];
  /** The answer keeps at least this much room, however many sources there are. */
  const answerRoom = Math.max(PAGE_LIMIT - "\n\nSources:".length - lines.reduce((sum, line) => sum + 1 + line.length, 0), PAGE_LIMIT / 2);
  const text = answer.length > answerRoom ? `${answer.slice(0, answerRoom - 1)}…` : answer;
  let page = text;
  for (const [index, line] of lines.entries()) {
    const next = `${page}${index === 0 ? "\n\nSources:" : ""}\n${line}`;
    if (next.length > PAGE_LIMIT) break;
    page = next;
  }
  return page;
}

function formatTaskList(tasks: ListedTask[], more: number, date: string | null): string {
  if (tasks.length === 0) return date === null ? "You have no Tasks yet." : `You have no Tasks due ${formatDay(date)}.`;
  const lines = tasks.map(
    (task, index) =>
      `${index + 1}. ${task.status === "done" ? "✓ " : ""}${task.heading}${formatDue(task.due)}` +
      (task.status === "done" ? " (done)" : ""),
  );
  if (more > 0) lines.push(`…and ${more} more. See them all on the dashboard.`);
  return [date === null ? "Your Tasks:" : `Your Tasks due ${formatDay(date)}:`, ...lines].join("\n");
}
