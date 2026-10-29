import { MongoClient, type Collection, type Db, type ObjectId } from "mongodb";

export type ChannelIdentity = { channel: string; channelId: string };

export type PasswordHash = { algorithm: "scrypt"; salt: string; hash: string };

export type UserDoc = {
  _id?: ObjectId;
  username: string;
  password: PasswordHash;
  isAdmin: boolean;
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

export type Database = {
  db: Db;
  users: Collection<UserDoc>;
  notes: Collection<NoteDoc>;
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

  return {
    db,
    users,
    notes: db.collection<NoteDoc>("notes"),
    close: () => client.close(),
  };
}
