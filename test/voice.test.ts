import { beforeEach, describe, expect, it } from "vitest";
import { createCore, type CoreEvent, type HandledMessage, type InboundMessage } from "../src/core/core.ts";
import { createOpenRouter } from "../src/llm/openrouter.ts";
import type { AudioSource, Transcriber } from "../src/transcriber/transcriber.ts";
import { ensureFirstAdmin } from "../src/users.ts";
import { toolCall, useFakeOpenRouter } from "./fakes/fake-openrouter.ts";
import { useMemoryMongo } from "./fakes/memory-mongo.ts";
import { unusedInventory } from "./fakes/unused.ts";

const MODEL = "test/model-a";

/** A Transcriber that returns a fixed Transcript, or fails, and counts what it was asked to do. */
function fakeTranscriber(outcome: { transcript: string } | { error: string }) {
  const fake = {
    model: "fake-whisper",
    calls: 0,
    async transcribe(audio: AudioSource): Promise<string> {
      fake.calls++;
      await audio.download("/unused/by/the/fake");
      if ("error" in outcome) throw new Error(outcome.error);
      return outcome.transcript;
    },
  } satisfies Transcriber & { calls: number };
  return fake;
}

describe("core: a Voice Message", () => {
  const database = useMemoryMongo();
  const openRouter = useFakeOpenRouter();

  async function send(message: InboundMessage, transcriber: Transcriber) {
    await ensureFirstAdmin(database(), { username: "owner", password: "pw", telegramId: "42", timezone: "UTC" });
    const core = createCore({
      database: database(),
      llm: createOpenRouter({ apiKey: "key", baseUrl: openRouter.baseUrl, models: [MODEL] }),
      inventory: unusedInventory,
      transcriber,
      defaultTimezone: "UTC",
    });
    const events: CoreEvent[] = [];
    const handled: HandledMessage = await core.handleMessage(message, async (event) => {
      events.push(event);
    });
    return { events, handled };
  }

  let downloads: number;
  beforeEach(() => {
    downloads = 0;
  });
  const voice = (durationSeconds: number, senderId = "42"): InboundMessage => ({
    sender: { channel: "telegram", channelId: senderId },
    chatId: `chat-${senderId}`,
    messageId: "2002",
    content: {
      kind: "voice",
      durationSeconds,
      download: async () => {
        downloads++;
      },
    },
  });

  it("becomes a Note just like the same words typed, keeping the Transcript", async () => {
    const transcript = "Remember that oat milk is cheaper at the Saturday market";
    openRouter.script(MODEL, toolCall("save_note", { heading: "Oat milk is cheaper at the market" }));

    const { events, handled } = await send(voice(12), fakeTranscriber({ transcript }));

    expect(events).toEqual([
      { type: "processing-started" },
      { type: "result", result: { kind: "note-saved", heading: "Oat milk is cheaper at the market" } },
    ]);
    expect(JSON.stringify(openRouter.requests[0]!.body.messages)).toContain(transcript);
    const notes = await database().notes.find().toArray();
    expect(notes).toMatchObject([{ text: transcript, transcript, source: { messageId: "2002" } }]);
    expect(handled.transcription).toEqual({
      model: "fake-whisper",
      durationMs: expect.any(Number),
      transcriptLength: transcript.length,
    });
  });

  it("produces the same events and saved Task as the same words typed", async () => {
    const words = "Remind me to renew the car insurance on 2026-11-02";
    const task = { heading: "Renew the car insurance", description: "Renew the car insurance", due_date: "2026-11-02" };
    openRouter.script(MODEL, toolCall("save_task", task));
    openRouter.script(MODEL, toolCall("save_task", task));
    const typed: InboundMessage = { ...voice(0), content: { kind: "text", text: words } };

    const fromTyping = await send(typed, fakeTranscriber({ transcript: "unused" }));
    const fromVoice = await send(voice(6), fakeTranscriber({ transcript: words }));

    expect(fromVoice.events).toEqual(fromTyping.events);
    const fields = ({ heading, description, due, transcript }: Record<string, unknown>) => ({
      heading,
      description,
      due,
      transcript,
    });
    const [typedTask, voiceTask] = await database().tasks.find().sort({ createdAt: 1, _id: 1 }).toArray();
    expect(fields(voiceTask!)).toEqual(fields(typedTask!));
  });

  it("becomes a Task just like the same words typed", async () => {
    openRouter.script(MODEL, toolCall("save_task", { heading: "Book the car service", description: "Call the garage" }));

    const { events } = await send(voice(8), fakeTranscriber({ transcript: "I need to book the car service" }));

    expect(events.at(-1)).toEqual({
      type: "result",
      result: { kind: "task-saved", heading: "Book the car service", due: null },
    });
    expect(await database().tasks.find().toArray()).toMatchObject([{ transcript: "I need to book the car service" }]);
  });

  it("over 5 minutes is refused with a request to split it, before anything is fetched or transcribed", async () => {
    const transcriber = fakeTranscriber({ transcript: "never heard" });

    const { events, handled } = await send(voice(301), transcriber);

    expect(events).toEqual([{ type: "result", result: { kind: "voice-too-long", maxSeconds: 300 } }]);
    expect(downloads).toBe(0);
    expect(transcriber.calls).toBe(0);
    expect(openRouter.requests).toHaveLength(0);
    expect(handled.transcription).toBeNull();
  });

  it("of exactly 5 minutes is transcribed", async () => {
    openRouter.script(MODEL, toolCall("save_note", { heading: "Long thought" }));

    const { events } = await send(voice(300), fakeTranscriber({ transcript: "A long thought" }));

    expect(events.at(-1)).toMatchObject({ result: { kind: "note-saved" } });
    expect(downloads).toBe(1);
  });

  it("that cannot be transcribed produces an error result and saves nothing", async () => {
    const { events, handled } = await send(voice(5), fakeTranscriber({ error: "whisper crashed" }));

    expect(events).toEqual([{ type: "processing-started" }, { type: "result", result: { kind: "error" } }]);
    expect(openRouter.requests).toHaveLength(0);
    expect(await database().notes.countDocuments()).toBe(0);
    expect(await database().tasks.countDocuments()).toBe(0);
    expect(handled.transcription).toEqual({ model: "fake-whisper", durationMs: expect.any(Number), error: "whisper crashed" });
  });

  it("from an unknown sender is refused without fetching the audio", async () => {
    const transcriber = fakeTranscriber({ transcript: "let me in" });

    const { events } = await send(voice(5, "999"), transcriber);

    expect(events).toEqual([{ type: "result", result: { kind: "refused" } }]);
    expect(downloads).toBe(0);
    expect(transcriber.calls).toBe(0);
  });
});
