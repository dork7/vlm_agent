import { randomBytes } from "node:crypto";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import type { UserDoc } from "../db.ts";
import { VOICE_AGENT_NAME, type LiveKitConfig } from "./config.ts";

/** How long the browser has to join with a token; the conversation itself may last longer. */
const TOKEN_TTL = "10m";

/** The LiveKit participant identity of a User talking on the Voice page. */
export function voiceIdentity(user: Pick<UserDoc, "_id">): string {
  return `user-${user._id!.toHexString()}`;
}

/**
 * A token that lets the User join a new room of their own, which LiveKit creates on join and
 * dispatches the voice agent into.
 */
export async function createVoiceToken(
  livekit: LiveKitConfig,
  user: Pick<UserDoc, "_id" | "username">,
): Promise<{ url: string; token: string; room: string }> {
  const room = `voice-${user._id!.toHexString()}-${randomBytes(4).toString("hex")}`;
  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: voiceIdentity(user),
    name: user.username,
    ttl: TOKEN_TTL,
  });
  token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  token.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: VOICE_AGENT_NAME })] });
  return { url: livekit.url, token: await token.toJwt(), room };
}
