import { MongoClient, MongoServerError, type Collection, type Db, type ObjectId } from "mongodb";

export type ChannelIdentity = { channel: string; channelId: string };

export type PasswordHash = { algorithm: "scrypt"; salt: string; hash: string };

export type UserDoc = {
  _id?: ObjectId;
  username: string;
  password: PasswordHash;
  isAdmin: boolean;
  /** IANA timezone in which this User's due dates and times are meant; absent means the configured default. */
  timezone?: string;
  channelIdentities: ChannelIdentity[];
  createdAt: Date;
};

export type NoteDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  heading: string;
  text: string;
  transcript: string;
  source: { channel: string; chatId: string; messageId: string };
  createdAt: Date;
  updatedAt: Date;
};

/** When a Task is due: a moment (date with a time), a whole day (date only), or never. */
export type TaskDue = { kind: "moment"; at: Date } | { kind: "date"; date: string } | null;

export type TaskDoc = {
  _id?: ObjectId;
  ownerId: ObjectId;
  heading: string;
  description: string;
  due: TaskDue;
  status: "open" | "done";
  reminderSentAt: Date | null;
  channelIdentity: ChannelIdentity;
  transcript: string;
  source: { channel: string; chatId: string; messageId: string };
  createdAt: Date;
  updatedAt: Date;
};

/** A message the bot has started handling, so that a second delivery of it is ignored. */
export type ProcessedMessageDoc = {
  channel: string;
  chatId: string;
  messageId: string;
  receivedAt: Date;
};

export type Database = {
  db: Db;
  users: Collection<UserDoc>;
  notes: Collection<NoteDoc>;
  tasks: Collection<TaskDoc>;
  processedMessages: Collection<ProcessedMessageDoc>;
  close(): Promise<void>;
};

export async function connectDatabase(uri: string, dbName: string): Promise<Database> {
  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);
  const users = db.collection<UserDoc>("users");
  await users.createIndex({ username: 1 }, { unique: true });
  await users.createIndex(
    { "channelIdentities.channel": 1, "channelIdentities.channelId": 1 },
    { unique: true, partialFilterExpression: { "channelIdentities.channel": { $exists: true } } },
  );

  const processedMessages = db.collection<ProcessedMessageDoc>("processedMessages");
  await processedMessages.createIndex({ channel: 1, chatId: 1, messageId: 1 }, { unique: true });

  return {
    db,
    users,
    notes: db.collection<NoteDoc>("notes"),
    tasks: db.collection<TaskDoc>("tasks"),
    processedMessages,
    close: () => client.close(),
  };
}

export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}
