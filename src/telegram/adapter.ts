import { writeFile } from "node:fs/promises";
import type { RouteHandlerMethod } from "fastify";
import { Bot, InlineKeyboard, webhookCallback, type BotConfig, type Context } from "grammy";
import type {
  ClarificationOption,
  Core,
  CoreEvent,
  Due,
  InboundMessage,
  ListedTask,
  ReminderEvent,
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
const GREETING =
  "Hi! Send a Voice Message or type, and I'll save it as a Note or a Task, or look something up in the Inventory. " +
  'Ask "show tasks" to see your Tasks.';

/** The Telegram Channel: turns updates into inbound messages and core events into Telegram calls. */
export function createTelegramBot(token: string, core: Core, config?: BotConfig<Context>): Bot {
  const bot = new Bot(token, config);

  bot.command("start", (ctx) => ctx.reply(GREETING));
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

  const render = async (event: CoreEvent) => {
    if (event.type === "processing-started") {
      if (replyId === undefined) replyId = (await ctx.reply(PROCESSING)).message_id;
      else await show(PROCESSING);
      return;
    }
    if (event.type === "clarification-needed") {
      const buttons = new InlineKeyboard();
      for (const option of event.options) buttons.text(OPTION_LABELS[option], `clarify:${event.clarificationId}:${option}`);
      return show(CLARIFICATION_QUESTION, buttons);
    }
    switch (event.result.kind) {
      case "note-saved":
        return show(`Saved Note: ${event.result.heading}`);
      case "task-saved":
        return show(`Saved Task: ${event.result.heading}${formatDue(event.result.due)}`);
      case "tasks-listed":
        return show(formatTaskList(event.result.tasks, event.result.more, event.result.date));
      case "query-answered":
        return show(event.result.answer);
      case "command-declined":
        return show(COMMAND_DECLINED);
      case "voice-too-long":
        return show(VOICE_TOO_LONG(event.result.maxSeconds));
      case "refused":
        return show(REFUSAL);
      case "error":
        return show(FAILURE);
    }
  };

  try {
    await core.handleMessage(message, render);
  } catch (error) {
    console.error("Failed to process Telegram message", error);
    await show(FAILURE).catch((replyError) => console.error("Failed to send failure reply", replyError));
  }
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
