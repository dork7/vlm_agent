import type { Collection, Db, ObjectId } from "mongodb";

/** The Dataset fields an Agent Bot needs to know the role of. */
export const FIELD_ROLES = ["location", "unit_type", "price", "images", "payment"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];
export type FieldMapping = Record<FieldRole, string>;

export type MissingImage = { row: number; path: string };

export type DatasetDoc = {
  _id?: ObjectId;
  name: string;
  /** File name inside the dataset folder this Dataset was imported from. */
  sourceFile: string;
  fields: string[];
  mapping: FieldMapping | null;
  rowCount: number;
  missingImages: MissingImage[];
  importedAt: Date;
};

/** One Listing: a Dataset row, with the mapped fields read out. */
export type DatasetRowDoc = {
  _id?: ObjectId;
  datasetId: ObjectId;
  /** 1-based position in the source file. */
  index: number;
  data: Record<string, string>;
  location: string;
  /** Normalised: "studio", "1BHK", "2BHK"... or the original text when it is not recognised. */
  unitType: string;
  price: number | null;
  images: string[];
};

export type Persona = {
  tone: string;
  language: string;
  /** Tried before the configured fallback list; empty means the list alone. */
  model: string;
  temperature: number;
  maxResults: number;
};

export type AgentBotDoc = {
  _id?: ObjectId;
  name: string;
  token: string;
  datasetId: ObjectId | null;
  persona: Persona;
  /** The Conversation Guide, Markdown. */
  guide: string;
  /** Whether the operator wants it running, so it comes back after an app restart. */
  enabled: boolean;
  propertyAgent: {
    telegramId: number | null;
    name: string | null;
    linkCode: string | null;
    linkCodeExpiresAt: Date | null;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type AgentMessageDoc = {
  _id?: ObjectId;
  botId: ObjectId;
  channel: string;
  chatId: string;
  role: "customer" | "bot";
  text: string;
  listingIds: ObjectId[];
  createdAt: Date;
};

export const APPOINTMENT_STATES = ["requested", "confirmed", "declined", "location-shared"] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];

export type AppointmentDoc = {
  _id?: ObjectId;
  botId: ObjectId;
  listingId: ObjectId;
  /** What the Listing was called when booked, so the record outlives a re-import. */
  listingSummary: string;
  customer: { channel: string; chatId: string; name: string | null };
  scheduledFor: Date;
  state: AppointmentState;
  /** Set once the Property Agent has been messaged about the request. */
  agentNotifiedAt: Date | null;
  /** The message asking the Property Agent for the location; a pin replying to it is matched to this Appointment. */
  locationPromptMessageId: number | null;
  createdAt: Date;
  decidedAt: Date | null;
  locationSharedAt: Date | null;
};

export type AgentsStore = {
  db: Db;
  datasets: Collection<DatasetDoc>;
  rows: Collection<DatasetRowDoc>;
  bots: Collection<AgentBotDoc>;
  messages: Collection<AgentMessageDoc>;
  appointments: Collection<AppointmentDoc>;
};

export function createAgentsStore(db: Db): AgentsStore {
  return {
    db,
    datasets: db.collection<DatasetDoc>("datasets"),
    rows: db.collection<DatasetRowDoc>("datasetRows"),
    bots: db.collection<AgentBotDoc>("agentBots"),
    messages: db.collection<AgentMessageDoc>("agentMessages"),
    appointments: db.collection<AppointmentDoc>("appointments"),
  };
}

export async function ensureAgentsIndexes(store: AgentsStore): Promise<void> {
  await store.rows.createIndex({ datasetId: 1, index: 1 });
  await store.messages.createIndex({ botId: 1, chatId: 1, createdAt: -1 });
  await store.messages.createIndex({ botId: 1, createdAt: -1 });
  await store.appointments.createIndex({ botId: 1, state: 1, createdAt: -1 });
}

/** A Listing as shown to customers: everything comes straight from the Dataset row. */
export type Listing = {
  id: string;
  location: string;
  unitType: string;
  price: number | null;
  priceText: string;
  payment: string;
  images: string[];
  data: Record<string, string>;
};

export const DEFAULT_PERSONA: Persona = { tone: "friendly and concise", language: "English", model: "", temperature: 0.3, maxResults: 3 };
