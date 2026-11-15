import type { Collection, Db, ObjectId } from "mongodb";
export type OwnerDoc = { email: string; createdAt: Date; lastSeenEventId: number; passwordHash?: string; offeredPassword?: boolean };
export type LoginTokenDoc = { email: string; tokenHash: string; expiresAt: Date; usedAt?: Date };
export type RefreshTokenDoc = { ownerId: ObjectId; tokenHash: string; expiresAt: Date; revokedAt?: Date; rotatedAt?: Date; family: string };
export type TaskStatus = "open" | "blocked" | "done";
export type TaskDoc = { ownerId: ObjectId; title: string; tags: string[]; instruction: string; note: string; blockedReason: string; status: TaskStatus; listId?: ObjectId; createdAt: Date; updatedAt: Date };
export type ListDoc = { ownerId: ObjectId; name: string; status: "draft" | "active"; taskCount: number; createdAt: Date; completedAt?: Date };
export type PersonDoc = { ownerId: ObjectId; name: string; nameLower: string };
export type AssignmentDoc = { ownerId: ObjectId; listId: ObjectId; personId: ObjectId; code: string; active: boolean; revokedAt?: Date; firstViewedAt?: Date; lastViewedAt?: Date; viewCount: number };
export type ViewDoc = { ownerId: ObjectId; assignmentId: ObjectId; viewedAt: Date; userAgent: string; browser: string; deviceType: string; counted: boolean };
export type EventKind = string;
export type EventDoc = { ownerId: ObjectId; seq: number; kind: EventKind; createdAt: Date; listId?: ObjectId; taskId?: ObjectId; personId?: ObjectId; fromValue?: string; toValue?: string; summary?: string };
export type AssignStore = { owners: Collection<OwnerDoc>; loginTokens: Collection<LoginTokenDoc>; refreshTokens: Collection<RefreshTokenDoc>; tasks: Collection<TaskDoc>; lists: Collection<ListDoc>; people: Collection<PersonDoc>; assignments: Collection<AssignmentDoc>; views: Collection<ViewDoc>; events: Collection<EventDoc>; counters: Collection<{ name: string; seq: number }> };
export async function openAssignStore(db: Db): Promise<AssignStore> {
  const store: AssignStore = { owners: db.collection("ta_owners"), loginTokens: db.collection("ta_login_tokens"), refreshTokens: db.collection("ta_refresh_tokens"), tasks: db.collection("ta_tasks"), lists: db.collection("ta_lists"), people: db.collection("ta_people"), assignments: db.collection("ta_assignments"), views: db.collection("ta_views"), events: db.collection("ta_events"), counters: db.collection("ta_counters") };
  await Promise.all([store.owners.createIndex({ email: 1 }, { unique: true }), store.loginTokens.createIndex({ tokenHash: 1 }, { unique: true }), store.refreshTokens.createIndex({ tokenHash: 1 }, { unique: true }), store.people.createIndex({ ownerId: 1, nameLower: 1 }, { unique: true }), store.assignments.createIndex({ code: 1 }, { unique: true }), store.assignments.createIndex({ ownerId: 1, listId: 1 }, { unique: true, partialFilterExpression: { active: true } }), store.events.createIndex({ seq: 1 }, { unique: true }), store.events.createIndex({ ownerId: 1, seq: 1 }), store.counters.createIndex({ name: 1 }, { unique: true })]);
  return store;
}
