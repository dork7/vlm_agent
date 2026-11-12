import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import ejs from "ejs";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AssignContext } from "./context.ts";
import { currentOwner } from "./auth.ts";
import { field, fields, parseForm, parseId } from "./http.ts";
import { recordEvent } from "./events.ts";
import type { AssignmentDoc, ListDoc, OwnerDoc, PersonDoc, TaskDoc, TaskStatus } from "./store.ts";

type Params = { id: string; code: string };
const esc = (x: unknown) => ejs.escapeXML(String(x ?? ""));
const themeMarkup = readFileSync(new URL("./views/theme.ejs", import.meta.url), "utf8");
const page = (title: string, body: string, live?: string, assignee = false) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${(assignee || live?.startsWith("/l/")) ? '<meta name="robots" content="noindex">' : ""}<title>${esc(title)}</title>${themeMarkup}</head><body class="${(assignee || live?.startsWith("/l/")) ? "assignee-page" : "assign-page"}">${(assignee || live?.startsWith("/l/")) ? "" : '<nav><a href="/assign">Board</a><a href="/assign/tasks">Tasks</a><a href="/assign/lists">Lists</a><a href="/assign/people">People</a><a href="/assign/feed">Activity</a><a href="/assign/settings">Settings</a></nav>'}<h1>${esc(title)}</h1>${body}${live ? `<script>const alertText=sessionStorage.getItem('ta_alert');if(alertText){const notice=document.createElement('aside');notice.setAttribute('role','alert');notice.textContent=alertText;document.body.prepend(notice);sessionStorage.removeItem('ta_alert')}const stream=new EventSource(${JSON.stringify(live)});stream.addEventListener('change',e=>{const event=JSON.parse(e.data);if(location.pathname==='/assign'&&['task.status','assignment.opened'].includes(event.kind))sessionStorage.setItem('ta_alert',event.summary||'Activity updated');location.reload()});stream.addEventListener('reset',()=>location.reload());stream.addEventListener('revoked',()=>location.reload());</script>` : ""}<script>for(const t of document.querySelectorAll('time[datetime]')){const d=new Date(t.dateTime),minutes=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));t.title=d.toLocaleString();t.textContent=minutes<1?'just now':minutes<60?minutes+' min ago':minutes<1440?Math.floor(minutes/60)+' h ago':d.toLocaleString();}</script></body></html>`;
const send = (reply: FastifyReply, title: string, body: string, live?: string, assignee = false) => reply.type("text/html; charset=utf-8").send(page(title, body, live, assignee));
const redirect = (reply: FastifyReply, path: string) => reply.code(303).header("location", path).send();
const fail = (reply: FastifyReply, code: number, message: string) => reply.code(code).type("text/plain").send(message);
const ownerOf = async (ctx: AssignContext, request: FastifyRequest, reply: FastifyReply) => {
  const owner = await currentOwner(ctx, request, reply);
  if (!owner) { reply.code(302).header("location", "/assign/login").send(); return null; }
  return owner;
};
const textLimit = (text: string, limit: number) => text.length <= limit;
const tagsFrom = (form: ReturnType<typeof parseForm>) => [...new Set(fields(form, "tags").flatMap(x => x.split(",")).map(x => x.trim().toLowerCase()).filter(Boolean))];
const idFrom = (request: FastifyRequest) => parseId((request.params as Params).id);
const taskLink = (task: TaskDoc & { _id: ObjectId }) => `<a href="/assign/tasks/${task._id}">${esc(task.title)}</a> <span class="${task.status}">${task.status}</span>`;

async function ownTask(ctx: AssignContext, owner: OwnerDoc & { _id: ObjectId }, request: FastifyRequest) {
  const _id = idFrom(request); return _id ? ctx.store.tasks.findOne({ _id, ownerId: owner._id }) : null;
}
async function ownList(ctx: AssignContext, owner: OwnerDoc & { _id: ObjectId }, request: FastifyRequest) {
  const _id = idFrom(request); return _id ? ctx.store.lists.findOne({ _id, ownerId: owner._id }) : null;
}
async function activeAssignment(ctx: AssignContext, code: string) {
  return /^[A-Za-z0-9]{10}$/.test(code) ? ctx.store.assignments.findOne({ code, active: true }) : null;
}
async function statusChange(ctx: AssignContext, task: TaskDoc & { _id: ObjectId }, status: TaskStatus, reason: string, actor?: { name: string; personId: ObjectId }) {
  if (status === "blocked" && !reason) return "Blocked needs a reason.";
  if (!textLimit(reason, 2000)) return "Reason is too long.";
  const before = task.status;
  await ctx.store.tasks.updateOne({ _id: task._id, ownerId: task.ownerId }, { $set: { status, blockedReason: status === "blocked" ? reason : "", updatedAt: ctx.now() } });
  await recordEvent(ctx, task.ownerId, "task.status", { taskId: task._id, listId: task.listId, personId: actor?.personId, fromValue: before, toValue: `${status}${reason ? `: ${reason}` : ""}`, summary: `${actor?.name || "Owner"} marked ${task.title} ${status}` });
  if (task.listId && status !== "done") await ctx.store.lists.updateOne({ _id: task.listId, ownerId: task.ownerId }, { $unset: { completedAt: "" } });
  if (task.listId && status === "done" && before !== "done") {
    const remaining = await ctx.store.tasks.countDocuments({ ownerId: task.ownerId, listId: task.listId, status: { $ne: "done" } });
    if (!remaining) {
      const won = await ctx.store.lists.findOneAndUpdate({ _id: task.listId, ownerId: task.ownerId, completedAt: { $exists: false } }, { $set: { completedAt: ctx.now() } });
      if (won) await recordEvent(ctx, task.ownerId, "list.complete", { listId: task.listId });
    }
  }
  return null;
}

export function registerWorkflow(app: FastifyInstance, ctx: AssignContext) {
  app.get("/assign/tasks", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return;
    const tag = String((request.query as { tag?: string }).tag || "").toLowerCase();
    const tasks = await ctx.store.tasks.find({ ownerId: owner._id, ...(tag ? { tags: tag } : {}) }).sort({ createdAt: -1 }).toArray();
    const body = `<form method="post" action="/assign/tasks"><input name="title" maxlength="200" placeholder="Task title" required><input name="tags" placeholder="tags, comma separated"><textarea name="instruction" maxlength="2000" placeholder="Instruction"></textarea><button>Add Task</button></form><form><input name="tag" value="${esc(tag)}" placeholder="Filter by tag"><button>Filter</button></form>${tasks.map(t => `<article>${taskLink(t)}${t.listId ? " · In a List" : ""}</article>`).join("")}`;
    return send(reply, "Tasks", body, "/assign/events");
  });
  app.post("/assign/tasks", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return;
    const form = parseForm(request.body), title = field(form, "title"), instruction = field(form, "instruction"), tags = tagsFrom(form);
    if (!title || !textLimit(title, 200) || !textLimit(instruction, 2000) || tags.length > 5 || tags.some(x => x.length > 30)) return fail(reply, 400, "Invalid Task fields.");
    const at = ctx.now(); const result = await ctx.store.tasks.insertOne({ ownerId: owner._id, title, instruction, tags, note: "", blockedReason: "", status: "open", createdAt: at, updatedAt: at });
    await recordEvent(ctx, owner._id, "task.create", { taskId: result.insertedId, toValue: title });
    return redirect(reply, "/assign/tasks");
  });
  app.get("/assign/tasks/:id", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return;
    const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    const body = `<form method="post" action="/assign/tasks/${task._id}/edit"><input name="title" maxlength="200" value="${esc(task.title)}"><input name="tags" value="${esc(task.tags.join(", "))}"><textarea name="instruction" maxlength="2000">${esc(task.instruction)}</textarea><button>Save</button></form><form method="post" action="/assign/tasks/${task._id}/status"><select name="status"><option>open</option><option>blocked</option><option>done</option></select><input name="reason" maxlength="2000" placeholder="Blocked reason"><button>Change status</button></form><form method="post" action="/assign/tasks/${task._id}/note"><textarea name="note" maxlength="2000">${esc(task.note)}</textarea><button>Save note</button></form><p><a href="/assign/tasks/${task._id}/delete">Delete…</a></p>`;
    return send(reply, task.title, body, "/assign/events");
  });
  app.post("/assign/tasks/:id/edit", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    const form = parseForm(request.body), title = field(form, "title"), instruction = field(form, "instruction"), tags = tagsFrom(form);
    if (!title || !textLimit(title, 200) || !textLimit(instruction, 2000) || tags.length > 5 || tags.some(x => x.length > 30)) return fail(reply, 400, "Invalid Task fields.");
    await ctx.store.tasks.updateOne({ _id: task._id, ownerId: owner._id }, { $set: { title, instruction, tags, updatedAt: ctx.now() } });
    await recordEvent(ctx, owner._id, "task.edit", { taskId: task._id, listId: task.listId, fromValue: JSON.stringify({ title: task.title, tags: task.tags, instruction: task.instruction }), toValue: JSON.stringify({ title, tags, instruction }) });
    return redirect(reply, `/assign/tasks/${task._id}`);
  });
  app.post("/assign/tasks/:id/status", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    const form = parseForm(request.body), status = field(form, "status"), reason = field(form, "reason");
    if (!["open", "blocked", "done"].includes(status)) return fail(reply, 400, "Invalid status.");
    const error = await statusChange(ctx, task, status as TaskStatus, reason); if (error) return fail(reply, 400, error);
    return redirect(reply, `/assign/tasks/${task._id}`);
  });
  app.post("/assign/tasks/:id/note", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    const note = field(parseForm(request.body), "note"); if (!textLimit(note, 2000)) return fail(reply, 400, "Note is too long.");
    await ctx.store.tasks.updateOne({ _id: task._id, ownerId: owner._id }, { $set: { note, updatedAt: ctx.now() } });
    await recordEvent(ctx, owner._id, "task.note", { taskId: task._id, listId: task.listId, fromValue: task.note, toValue: note });
    return redirect(reply, `/assign/tasks/${task._id}`);
  });
  app.get("/assign/lists", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return;
    const [lists, tasks] = await Promise.all([ctx.store.lists.find({ ownerId: owner._id }).toArray(), ctx.store.tasks.find({ ownerId: owner._id }).toArray()]);
    const body = `<form method="post" action="/assign/lists"><input name="name" maxlength="200" placeholder="List name" required>${tasks.map(t => `<label><input type="checkbox" name="taskIds" value="${t._id}" ${t.listId ? "disabled" : ""}>${esc(t.title)}${t.listId ? ` (already in ${esc(lists.find(l => l._id.equals(t.listId!))?.name || "another List")})` : ""}</label>`).join("<br>")}<button>Create List</button></form>${lists.map(l => `<article><a href="/assign/lists/${l._id}">${esc(l.name)}</a> · ${l.status}</article>`).join("")}`;
    return send(reply, "Lists", body, "/assign/events");
  });
  app.post("/assign/lists", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const form = parseForm(request.body), name = field(form, "name"), ids = [...new Set(fields(form, "taskIds"))];
    if (!name || !textLimit(name, 200) || ids.length > 50 || ids.some(x => !parseId(x))) return fail(reply, 400, "Invalid List.");
    const tasks = await ctx.store.tasks.find({ ownerId: owner._id, _id: { $in: ids.map(x => new ObjectId(x)) } }).toArray();
    if (tasks.length !== ids.length) return fail(reply, 404, "Task not found.");
    const occupied = tasks.find(t => t.listId); if (occupied) { const other = await ctx.store.lists.findOne({ ownerId: owner._id, _id: occupied.listId }); return fail(reply, 400, `Task already in ${other?.name || "another List"}.`); }
    const list = await ctx.store.lists.insertOne({ ownerId: owner._id, name, status: "draft", taskCount: ids.length, createdAt: ctx.now() });
    const attached = await ctx.store.tasks.updateMany({ ownerId: owner._id, _id: { $in: tasks.map(t => t._id) }, listId: { $exists: false } }, { $set: { listId: list.insertedId } });
    if (attached.modifiedCount !== ids.length) {
      await ctx.store.tasks.updateMany({ ownerId: owner._id, listId: list.insertedId }, { $unset: { listId: "" } });
      await ctx.store.lists.deleteOne({ _id: list.insertedId, ownerId: owner._id });
      return fail(reply, 409, "A Task was added to another List. Try again.");
    }
    await recordEvent(ctx, owner._id, "list.create", { listId: list.insertedId, toValue: name });
    return redirect(reply, `/assign/lists/${list.insertedId}`);
  });
  app.get("/assign/lists/:id", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    const [tasks, free, assignment] = await Promise.all([ctx.store.tasks.find({ ownerId: owner._id, listId: list._id }).toArray(), ctx.store.tasks.find({ ownerId: owner._id, listId: { $exists: false } }).toArray(), ctx.store.assignments.findOne({ ownerId: owner._id, listId: list._id, active: true })]);
    const body = `<form method="post" action="/assign/lists/${list._id}/edit"><input name="name" value="${esc(list.name)}" maxlength="200"><button>Rename</button></form>${tasks.map(t => `<article>${taskLink(t)}<form method="post" action="/assign/lists/${list._id}/remove"><input type="hidden" name="taskId" value="${t._id}"><button>Remove</button></form></article>`).join("")}<form method="post" action="/assign/lists/${list._id}/add"><select name="taskId">${free.map(t => `<option value="${t._id}">${esc(t.title)}</option>`).join("")}</select><button>Add Task</button></form>${assignment ? `<p>Link: <input readonly value="${esc(ctx.config.publicUrl)}/l/${assignment.code}"><button onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">Copy</button></p><form method="post" action="/assign/lists/${list._id}/revoke"><button>Revoke</button></form>` : ""}<form method="post" action="/assign/lists/${list._id}/assign"><input name="person" maxlength="200" placeholder="Person name" required><button>${assignment ? "Reassign" : "Assign"}</button></form><p><a href="/assign/lists/${list._id}/delete">Delete…</a></p>`;
    return send(reply, list.name, body, "/assign/events");
  });
  app.post("/assign/lists/:id/edit", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    const name = field(parseForm(request.body), "name"); if (!name || !textLimit(name, 200)) return fail(reply, 400, "Invalid List name.");
    await ctx.store.lists.updateOne({ _id: list._id, ownerId: owner._id }, { $set: { name } }); await recordEvent(ctx, owner._id, "list.edit", { listId: list._id, fromValue: list.name, toValue: name }); return redirect(reply, `/assign/lists/${list._id}`);
  });
  app.post("/assign/lists/:id/add", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    const taskId = parseId(field(parseForm(request.body), "taskId")); if (!taskId) return fail(reply, 400, "Invalid Task.");
    const task = await ctx.store.tasks.findOne({ _id: taskId, ownerId: owner._id }); if (!task) return fail(reply, 404, "Task not found.");
    if (task.listId) { const other = await ctx.store.lists.findOne({ _id: task.listId, ownerId: owner._id }); return fail(reply, 400, `Task already in ${other?.name || "another List"}.`); }
    const reserved = await ctx.store.lists.findOneAndUpdate({ _id: list._id, ownerId: owner._id, taskCount: { $lt: 50 } }, { $inc: { taskCount: 1 } });
    if (!reserved) return fail(reply, 400, "A List holds at most 50 Tasks.");
    const result = await ctx.store.tasks.updateOne({ _id: taskId, ownerId: owner._id, listId: { $exists: false } }, { $set: { listId: list._id } });
    if (!result.modifiedCount) { await ctx.store.lists.updateOne({ _id: list._id, ownerId: owner._id }, { $inc: { taskCount: -1 } }); return fail(reply, 409, "Task already assigned."); }
    await recordEvent(ctx, owner._id, "list.add", { listId: list._id, taskId, fromValue: "unassigned", toValue: list.name }); return redirect(reply, `/assign/lists/${list._id}`);
  });
  app.post("/assign/lists/:id/remove", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    const taskId = parseId(field(parseForm(request.body), "taskId")); if (!taskId) return fail(reply, 400, "Invalid Task.");
    const result = await ctx.store.tasks.updateOne({ _id: taskId, ownerId: owner._id, listId: list._id }, { $unset: { listId: "" } }); if (!result.modifiedCount) return fail(reply, 404, "Task not in List.");
    await ctx.store.lists.updateOne({ _id: list._id, ownerId: owner._id }, { $inc: { taskCount: -1 } });
    await recordEvent(ctx, owner._id, "list.remove", { listId: list._id, taskId, fromValue: list.name, toValue: "unassigned" }); return redirect(reply, `/assign/lists/${list._id}`);
  });
  app.post("/assign/lists/:id/assign", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    const name = field(parseForm(request.body), "person"); if (!name || !textLimit(name, 200)) return fail(reply, 400, "Invalid Person name.");
    let person = await ctx.store.people.findOne({ ownerId: owner._id, nameLower: name.toLowerCase() });
    if (!person) { try { const result = await ctx.store.people.insertOne({ ownerId: owner._id, name, nameLower: name.toLowerCase() }); person = await ctx.store.people.findOne({ _id: result.insertedId, ownerId: owner._id }); } catch { person = await ctx.store.people.findOne({ ownerId: owner._id, nameLower: name.toLowerCase() }); } }
    if (!person) return fail(reply, 500, "Could not create Person.");
    const previous = await ctx.store.assignments.findOne({ ownerId: owner._id, listId: list._id, active: true });
    await ctx.store.assignments.updateMany({ ownerId: owner._id, listId: list._id, active: true }, { $set: { active: false, revokedAt: ctx.now() } });
    if (previous) await recordEvent(ctx, owner._id, "assignment.revoke", { listId: list._id, personId: previous.personId });
    let code = ""; const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    while (code.length < 10) for (const byte of randomBytes(20)) { if (byte < 248) code += alphabet[byte % 62]; if (code.length === 10) break; }
    await ctx.store.assignments.insertOne({ ownerId: owner._id, listId: list._id, personId: person._id, code, active: true, viewCount: 0 });
    await ctx.store.lists.updateOne({ _id: list._id, ownerId: owner._id }, { $set: { status: "active" } });
    await recordEvent(ctx, owner._id, "assignment.create", { listId: list._id, personId: person._id }); return redirect(reply, `/assign/lists/${list._id}`);
  });
  app.post("/assign/lists/:id/revoke", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    await ctx.store.assignments.updateMany({ ownerId: owner._id, listId: list._id, active: true }, { $set: { active: false, revokedAt: ctx.now() } });
    await ctx.store.lists.updateOne({ _id: list._id, ownerId: owner._id }, { $set: { status: "draft" } });
    await recordEvent(ctx, owner._id, "assignment.revoke", { listId: list._id }); return redirect(reply, `/assign/lists/${list._id}`);
  });
  app.get("/l/:code", async (request, reply) => {
    const code = (request.params as Params).code;
    const assignment = await activeAssignment(ctx, code);
    reply.header("X-Robots-Tag", "noindex");
    if (!assignment) return send(reply, "Link no longer available", "<p>This link has been revoked or replaced.</p>", undefined, true);
    const [list, person, tasks] = await Promise.all([ctx.store.lists.findOne({ _id: assignment.listId, ownerId: assignment.ownerId }), ctx.store.people.findOne({ _id: assignment.personId, ownerId: assignment.ownerId }), ctx.store.tasks.find({ ownerId: assignment.ownerId, listId: assignment.listId }).toArray()]);
    if (!list || !person) return fail(reply, 404, "Link no longer available.");
    const showTask = (t: TaskDoc & { _id: ObjectId }) => `<article><h3>${esc(t.title)}</h3><p>${t.tags.map(esc).join(", ")}</p><p>${esc(t.instruction)}</p><p class="${t.status}">${t.status}${t.blockedReason ? `: ${esc(t.blockedReason)}` : ""}</p><p>${esc(t.note)}</p><form method="post" action="/l/${code}/tasks/${t._id}/status"><select name="status"><option>open</option><option>blocked</option><option>done</option></select><input name="reason" maxlength="2000" placeholder="Blocked reason"><button>Save status</button></form><form method="post" action="/l/${code}/tasks/${t._id}/note"><textarea name="note" maxlength="2000">${esc(t.note)}</textarea><button>Save note</button></form></article>`;
    const done = tasks.filter(t => t.status === "done"), pending = tasks.filter(t => t.status !== "done");
    const body = `<meta name="robots" content="noindex"><p>For ${esc(person.name)}</p>${pending.map(showTask).join("")}<details><summary>Done (${done.length})</summary>${done.map(showTask).join("")}</details><script>navigator.sendBeacon('/l/${code}/view',new Blob([], {type:'text/plain'}))</script>`;
    return send(reply, list.name, body, `/l/${code}/events`);
  });
  for (const action of ["status", "note"] as const) app.post(`/l/:code/tasks/:id/${action}`, async (request, reply) => {
    const { code, id } = request.params as Params; const assignment = await activeAssignment(ctx, code); if (!assignment) return fail(reply, 404, "Link no longer available.");
    const taskId = parseId(id); if (!taskId) return fail(reply, 404, "Task not found.");
    const task = await ctx.store.tasks.findOne({ _id: taskId, ownerId: assignment.ownerId, listId: assignment.listId }); if (!task) return fail(reply, 404, "Task not found.");
    const form = parseForm(request.body);
    if (action === "status") {
      const status = field(form, "status"), reason = field(form, "reason"); if (!["open", "blocked", "done"].includes(status)) return fail(reply, 400, "Invalid status.");
      const person = await ctx.store.people.findOne({ _id: assignment.personId, ownerId: assignment.ownerId });
      const error = await statusChange(ctx, task, status as TaskStatus, reason, person ? { name: person.name, personId: person._id } : undefined); if (error) return fail(reply, 400, error);
    } else {
      const note = field(form, "note"); if (!textLimit(note, 2000)) return fail(reply, 400, "Note is too long.");
      await ctx.store.tasks.updateOne({ _id: taskId, ownerId: assignment.ownerId, listId: assignment.listId }, { $set: { note, updatedAt: ctx.now() } });
      await recordEvent(ctx, assignment.ownerId, "task.note", { listId: assignment.listId, taskId, personId: assignment.personId, fromValue: task.note, toValue: note });
    }
    return redirect(reply, `/l/${code}`);
  });
  app.post("/l/:code/view", async (request, reply) => {
    const assignment = await activeAssignment(ctx, (request.params as Params).code); if (!assignment) return fail(reply, 404, "Link no longer available.");
    const userAgent = String(request.headers["user-agent"] || "").slice(0, 500);
    const bot = /bot|crawler|preview|WhatsApp|facebookexternalhit|Slack|Discord|Twitter|LinkedIn/i.test(userAgent);
    const owner = await currentOwner(ctx, request);
    const counted = !bot && !owner;
    const browser = /Firefox/i.test(userAgent) ? "Firefox" : /Chrome/i.test(userAgent) ? "Chrome" : /Safari/i.test(userAgent) ? "Safari" : "Other";
    const deviceType = /Mobile|Android|iPhone/i.test(userAgent) ? "mobile" : "desktop";
    await ctx.store.views.insertOne({ ownerId: assignment.ownerId, assignmentId: assignment._id, viewedAt: ctx.now(), userAgent, browser, deviceType, counted });
    if (counted) {
      const first = await ctx.store.assignments.findOneAndUpdate({ _id: assignment._id, active: true, firstViewedAt: { $exists: false } }, { $set: { firstViewedAt: ctx.now(), lastViewedAt: ctx.now() }, $inc: { viewCount: 1 } });
      if (first) {
        const [person, list] = await Promise.all([ctx.store.people.findOne({ _id: assignment.personId, ownerId: assignment.ownerId }), ctx.store.lists.findOne({ _id: assignment.listId, ownerId: assignment.ownerId })]);
        await recordEvent(ctx, assignment.ownerId, "assignment.opened", { listId: assignment.listId, personId: assignment.personId, summary: `${person?.name || "Someone"} opened ${list?.name || "a List"}` });
      }
      else await ctx.store.assignments.updateOne({ _id: assignment._id, active: true }, { $set: { lastViewedAt: ctx.now() }, $inc: { viewCount: 1 } });
    }
    return reply.code(204).send();
  });
  app.get("/assign", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return;
    const query = request.query as { person?: string; tag?: string; status?: string };
    const [people, lists, tasks, assignments, unread] = await Promise.all([ctx.store.people.find({ ownerId: owner._id }).toArray(), ctx.store.lists.find({ ownerId: owner._id }).toArray(), ctx.store.tasks.find({ ownerId: owner._id }).toArray(), ctx.store.assignments.find({ ownerId: owner._id, active: true }).toArray(), ctx.store.events.countDocuments({ ownerId: owner._id, seq: { $gt: owner.lastSeenEventId } })]);
    const shown = (t: TaskDoc) => (!query.tag || t.tags.includes(query.tag)) && (!query.status || t.status === query.status);
    const sections = people.filter(p => !query.person || p._id.toHexString() === query.person).map(p => {
      const mine = assignments.filter(a => a.personId.equals(p._id) && ((!query.tag && !query.status) || tasks.some(t => t.listId?.equals(a.listId) && shown(t))));
      return `<section><h2>${esc(p.name)}</h2>${mine.map(a => { const list = lists.find(l => l._id.equals(a.listId)); const all = tasks.filter(t => t.listId?.equals(a.listId)); const visible = all.filter(shown); return `<article><a href="/assign/lists/${a.listId}">${esc(list?.name)}</a> · ${all.filter(t => t.status === "done").length} of ${all.length} done · ${a.lastViewedAt ? `Viewed <time datetime="${a.lastViewedAt.toISOString()}"></time>` : "Not opened"}${visible.map(t => `<p class="${t.status}">${esc(t.title)} ${t.status}${t.blockedReason ? `: ${esc(t.blockedReason)}` : ""}</p>`).join("")}</article>`; }).join("")}</section>`;
    }).join("");
    const unassigned = query.person ? [] : tasks.filter(t => !t.listId && shown(t));
    const drafts = query.person ? [] : lists.filter(l => l.status === "draft" && ((!query.tag && !query.status) || tasks.some(t => t.listId?.equals(l._id) && shown(t))));
    const body = `<form><select name="person"><option value="">All people</option>${people.map(p => `<option value="${p._id}">${esc(p.name)}</option>`).join("")}</select><input name="tag" placeholder="Tag" value="${esc(query.tag || "")}"><select name="status"><option value="">All statuses</option><option>open</option><option>blocked</option><option>done</option></select><button>Filter</button></form><p><a href="/assign/feed">Activity (${unread} unread)</a></p>${sections}<section><h2>Draft Lists</h2>${drafts.map(l => `<p><a href="/assign/lists/${l._id}">${esc(l.name)}</a></p>`).join("")}</section><section><h2>Unassigned Tasks</h2>${unassigned.map(t => `<p>${taskLink(t)}</p>`).join("")}</section>`;
    return send(reply, "Board", body, "/assign/events");
  });
  app.get("/assign/feed", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return;
    const [events, tasks, lists, people] = await Promise.all([ctx.store.events.find({ ownerId: owner._id }).sort({ seq: -1 }).limit(200).toArray(), ctx.store.tasks.find({ ownerId: owner._id }).toArray(), ctx.store.lists.find({ ownerId: owner._id }).toArray(), ctx.store.people.find({ ownerId: owner._id }).toArray()]);
    await ctx.store.owners.updateOne({ _id: owner._id }, { $set: { lastSeenEventId: events[0]?.seq || 0 } });
    const describe = (event: typeof events[number]) => {
      const task = tasks.find(t => t._id.equals(event.taskId || new ObjectId()))?.title || event.fromValue || event.toValue || "Task";
      const list = lists.find(l => l._id.equals(event.listId || new ObjectId()))?.name || "List";
      const person = people.find(p => p._id.equals(event.personId || new ObjectId()))?.name || "Someone";
      if (event.kind === "assignment.opened") return `${person} opened ${list}`;
      if (event.kind === "list.complete") return `${list} complete`;
      if (event.kind === "task.status") return `${task}: ${event.toValue}`;
      if (event.kind === "task.create") return `Created ${task}`;
      if (event.kind === "task.delete") return `Deleted ${task}`;
      return `${event.kind.replaceAll(".", " ")} ${task}`;
    };
    return send(reply, "Activity", events.map(e => `<article>${esc(describe(e))} <time datetime="${e.createdAt.toISOString()}"></time></article>`).join(""), "/assign/events");
  });
  app.get("/assign/people", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const people = await ctx.store.people.find({ ownerId: owner._id }).toArray();
    const body = (await Promise.all(people.map(async p => `<article>${esc(p.name)} · ${await ctx.store.assignments.countDocuments({ ownerId: owner._id, personId: p._id, active: true })} active links <a href="/assign/people/${p._id}/delete">Delete…</a></article>`))).join("");
    return send(reply, "People", body);
  });
  app.get("/assign/tasks/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    const assignment = task.listId ? await ctx.store.assignments.findOne({ ownerId: owner._id, listId: task.listId, active: true }) : null;
    const person = assignment ? await ctx.store.people.findOne({ _id: assignment.personId, ownerId: owner._id }) : null;
    return send(reply, `Delete ${task.title}?`, `${person ? `Removes it from ${esc(person.name)}'s link.` : "Deletes it."}<form method="post"><button>Delete Task</button></form>`);
  });
  app.post("/assign/tasks/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    await ctx.store.tasks.deleteOne({ _id: task._id, ownerId: owner._id });
    if (task.listId) await ctx.store.lists.updateOne({ _id: task.listId, ownerId: owner._id }, { $inc: { taskCount: -1 } });
    await recordEvent(ctx, owner._id, "task.delete", { taskId: task._id, listId: task.listId, fromValue: task.title }); return redirect(reply, "/assign/tasks");
  });
  app.get("/assign/lists/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    const count = await ctx.store.tasks.countDocuments({ ownerId: owner._id, listId: list._id }); const active = await ctx.store.assignments.countDocuments({ ownerId: owner._id, listId: list._id, active: true });
    return send(reply, `Delete ${list.name}?`, `Revokes ${active} active links and returns ${count} Tasks to the pool.<form method="post"><button>Delete List</button></form>`);
  });
  app.post("/assign/lists/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    await ctx.store.assignments.updateMany({ ownerId: owner._id, listId: list._id, active: true }, { $set: { active: false, revokedAt: ctx.now() } });
    await ctx.store.tasks.updateMany({ ownerId: owner._id, listId: list._id }, { $unset: { listId: "" } }); await ctx.store.lists.deleteOne({ _id: list._id, ownerId: owner._id });
    await recordEvent(ctx, owner._id, "list.delete", { listId: list._id }); return redirect(reply, "/assign/lists");
  });
  app.get("/assign/people/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const id = idFrom(request); const person = id && await ctx.store.people.findOne({ _id: id, ownerId: owner._id }); if (!person) return fail(reply, 404, "Person not found.");
    const count = await ctx.store.assignments.countDocuments({ ownerId: owner._id, personId: person._id, active: true }); return send(reply, `Delete ${person.name}?`, `Revokes ${count} active links.<form method="post"><button>Delete Person</button></form>`);
  });
  app.post("/assign/people/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const id = idFrom(request); const person = id && await ctx.store.people.findOne({ _id: id, ownerId: owner._id }); if (!person) return fail(reply, 404, "Person not found.");
    const active = await ctx.store.assignments.find({ ownerId: owner._id, personId: person._id, active: true }).toArray();
    await ctx.store.assignments.updateMany({ ownerId: owner._id, personId: person._id, active: true }, { $set: { active: false, revokedAt: ctx.now() } });
    await ctx.store.lists.updateMany({ ownerId: owner._id, _id: { $in: active.map(a => a.listId) } }, { $set: { status: "draft" } });
    await ctx.store.people.deleteOne({ _id: person._id, ownerId: owner._id });
    for (const assignment of active) await recordEvent(ctx, owner._id, "person.delete", { personId: person._id, listId: assignment.listId });
    return redirect(reply, "/assign/people");
  });
}
