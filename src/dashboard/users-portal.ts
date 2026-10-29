import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ObjectId } from "mongodb";
import type { ChannelIdentity, Database } from "../db.ts";
import {
  addChannelIdentity,
  createUser,
  deleteUser,
  removeChannelIdentity,
  resetPassword,
  setTimezone,
  UserChangeError,
} from "../users.ts";
import { adminOnly, badRequest, field, notFound, parseId, render, type Form } from "./http.ts";

export type UsersPortalOptions = { database: Database; defaultTimezone: string };

/** The admin-only Users portal, mounted inside the dashboard so the request already carries its logged-in User. */
export const usersPortalRoutes: FastifyPluginAsync<UsersPortalOptions> = async (app, { database, defaultTimezone }) => {
  app.addHook("onRequest", adminOnly("manage Users"));

  /** Runs an admin's change and redirects where it says; null is not found, and a refusal is a 400 that says why. */
  const change = async (reply: FastifyReply, run: () => Promise<string | null>) => {
    try {
      const next = await run();
      return next === null ? notFound(reply) : reply.redirect(next, 303);
    } catch (error) {
      if (error instanceof UserChangeError) return badRequest(reply, error.message);
      throw error;
    }
  };

  /** A password is taken as typed: spaces are part of it. */
  const passwordIn = (form: Form): string => (typeof form?.password === "string" ? form.password : "");

  app.get("/users", async (_request, reply) => {
    const users = await database.users.find().sort({ username: 1 }).toArray();
    return render(reply, "users", { users, defaultTimezone });
  });

  app.post<{ Body: Form }>("/users", async (request, reply) =>
    change(reply, async () => {
      const timezone = field(request.body, "timezone");
      const id = await createUser(database, {
        username: field(request.body, "username"),
        password: passwordIn(request.body),
        isAdmin: field(request.body, "isAdmin") !== "",
        ...(timezone ? { timezone } : {}),
      });
      return `/users/${id}`;
    }),
  );

  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const _id = parseId(request.params.id);
    const user = _id && (await database.users.findOne({ _id }));
    if (!user) return notFound(reply);
    return render(reply, "user", { user, defaultTimezone });
  });

  type UserChange = { Params: { id: string }; Body: Form };

  /** Runs an admin's change to one User, then shows that User's page; a missing User is not found. */
  const changeUser = (reply: FastifyReply, id: string, run: (userId: ObjectId) => Promise<boolean>) =>
    change(reply, async () => {
      const userId = parseId(id);
      return userId && (await run(userId)) ? `/users/${userId}` : null;
    });

  const identityIn = (form: Form): ChannelIdentity => ({
    channel: field(form, "channel"),
    channelId: field(form, "channelId"),
  });

  app.post<UserChange>("/users/:id/identities", async (request, reply) =>
    changeUser(reply, request.params.id, (userId) => addChannelIdentity(database, userId, identityIn(request.body))),
  );

  app.post<UserChange>("/users/:id/identities/remove", async (request, reply) =>
    changeUser(reply, request.params.id, (userId) => removeChannelIdentity(database, userId, identityIn(request.body))),
  );

  app.post<UserChange>("/users/:id/timezone", async (request, reply) =>
    changeUser(reply, request.params.id, (userId) =>
      setTimezone(database, userId, field(request.body, "timezone") || undefined),
    ),
  );

  app.post<UserChange>("/users/:id/password", async (request, reply) =>
    changeUser(reply, request.params.id, (userId) => resetPassword(database, userId, passwordIn(request.body))),
  );

  app.post<UserChange>("/users/:id/delete", async (request, reply) =>
    change(reply, async () => {
      const userId = parseId(request.params.id);
      // Deleting yourself would lock you out, possibly leaving no admin at all.
      if (userId?.equals(request.user._id!)) throw new UserChangeError("You cannot delete yourself.");
      return userId && (await deleteUser(database, userId)) ? "/users" : null;
    }),
  );
};
