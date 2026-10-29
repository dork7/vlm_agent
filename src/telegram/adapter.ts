import { writeFile } from "node:fs/promises";
import type { RouteHandlerMethod } from "fastify";
import { Bot, webhookCallback, type BotConfig, type Context } from "grammy";
import type { Core, CoreEvent, Due, InboundMessage, ListedTask } from "../core/core.ts";
import { formatDay } from "../time.ts";

const PROCESSING = "processing…";
const REFUSAL = "Sorry, you're not allowed to use this bot. Please ask its owner for access.";
const FAILURE = "Sorry, I couldn't process that. Please try again.";
const VOICE_TOO_LONG = (maxSeconds: number) =>
  `Sorry, that Voice Message is over ${maxSeconds / 60} minutes. Please split it into shorter ones.`;
const COMMAND_DECLINED = "Sorry, changing Inventory data isn't supported yet. You can ask me about it instead.";
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
    void handleMessage(ctx, core, { kind: "text", text: ctx.message.text });
  });
  bot.on("message:voice", (ctx) => {
    const { file_id, duration } = ctx.message.voice;
    void handleMessage(ctx, core, {
      kind: "voice",
      durationSeconds: duration,
      download: (toPath) => downloadFile(ctx, file_id, toPath),
    });
  });

  bot.catch((error) => console.error("Telegram update failed", error.error));

  return bot;
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
  ctx: Context & { message: { message_id: number } },
  core: Core,
  content: InboundMessage["content"],
) {
  const message: InboundMessage = {
    sender: { channel: "telegram", channelId: String(ctx.from!.id) },
    chatId: String(ctx.chat!.id),
    messageId: String(ctx.message.message_id),
    content,
  };

  let processingReplyId: number | undefined;
  // Edit the processing reply when there is one, otherwise send a new message.
  const show = async (text: string) => {
    if (processingReplyId === undefined) await ctx.reply(text);
    else await ctx.api.editMessageText(ctx.chat!.id, processingReplyId, text);
  };

  const render = async (event: CoreEvent) => {
    if (event.type === "processing-started") {
      processingReplyId = (await ctx.reply(PROCESSING)).message_id;
      return;
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
