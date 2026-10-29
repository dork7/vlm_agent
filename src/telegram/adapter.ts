import { Bot, type Context } from "grammy";
import type { Core, CoreEvent, Due, InboundMessage, ListedTask } from "../core/core.ts";
import { formatDay } from "../time.ts";

const PROCESSING = "processing…";
const REFUSAL = "Sorry, you're not allowed to use this bot. Please ask its owner for access.";
const FAILURE = "Sorry, I couldn't process that. Please try again.";
const GREETING = 'Hi! Type a message and I\'ll save it as a Note or a Task. Ask "show tasks" to see your Tasks.';

/** The Telegram Channel: turns updates into inbound messages and core events into Telegram calls. */
export function createTelegramBot(token: string, core: Core): Bot {
  const bot = new Bot(token);

  bot.command("start", (ctx) => ctx.reply(GREETING));
  // Other bot commands are not messages to file.
  bot.on("message:text").filter((ctx) => !ctx.entities("bot_command").some((e) => e.offset === 0), (ctx) => {
    // Acknowledge the update straight away and process the message in the background.
    void handleTextMessage(ctx, core);
  });

  bot.catch((error) => console.error("Telegram update failed", error.error));

  return bot;
}

async function handleTextMessage(ctx: Context & { message: { text: string } }, core: Core) {
  const message: InboundMessage = {
    sender: { channel: "telegram", channelId: String(ctx.from!.id) },
    chatId: String(ctx.chat!.id),
    messageId: String(ctx.message.message_id),
    content: { kind: "text", text: ctx.message.text },
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
        return show(formatTaskList(event.result.tasks, event.result.more));
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

/** E.g. " (due Thu 29 Oct 2026, 15:00)", or "" when there is no due date. */
function formatDue(due: Due): string {
  if (due === null) return "";
  return ` (due ${formatDay(due.date)}${due.time ? `, ${due.time}` : ""})`;
}

function formatTaskList(tasks: ListedTask[], more: number): string {
  if (tasks.length === 0) return "You have no Tasks yet.";
  const lines = tasks.map(
    (task, index) =>
      `${index + 1}. ${task.status === "done" ? "✓ " : ""}${task.heading}${formatDue(task.due)}` +
      (task.status === "done" ? " (done)" : ""),
  );
  if (more > 0) lines.push(`…and ${more} more. See them all on the dashboard.`);
  return ["Your Tasks:", ...lines].join("\n");
}
