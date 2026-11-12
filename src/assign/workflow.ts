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
const navMarkup = ejs.compile(readFileSync(new URL("./views/nav.ejs", import.meta.url), "utf8"));
type PageOptions = { live?: string; assignee?: boolean; current?: string };
// Live pages reload on change, unless the person has started typing: then they get a notice instead of losing their input.
const liveScript = (live: string) => `<script>(()=>{const main=document.getElementById('main');const notice=(role,text)=>{const n=document.createElement('aside');n.setAttribute('role',role);n.textContent=text;main.prepend(n);return n};const alertText=sessionStorage.getItem('ta_alert');if(alertText){notice('alert',alertText);sessionStorage.removeItem('ta_alert')}let dirty=false,leaving=false;document.addEventListener('input',e=>{if(e.target.form)dirty=true});document.addEventListener('submit',e=>{const method=(e.submitter&&e.submitter.getAttribute('formmethod'))||e.target.getAttribute('method');if(method!=='dialog')leaving=true});addEventListener('beforeunload',()=>{leaving=true});const refresh=text=>{if(leaving)return;if(!dirty){location.reload();return}if(document.getElementById('ta-stale'))return;const n=notice('status',(text||'This page has updates.')+' ');n.id='ta-stale';const b=document.createElement('button');b.type='button';b.textContent='Reload to see them';b.addEventListener('click',()=>location.reload());n.append(b)};const stream=new EventSource(${JSON.stringify(live)});stream.addEventListener('change',e=>{const event=JSON.parse(e.data);if(location.pathname==='/assign'&&['task.status','assignment.opened'].includes(event.kind))sessionStorage.setItem('ta_alert',event.summary||'Activity updated');refresh(event.summary)});stream.addEventListener('reset',()=>refresh());stream.addEventListener('revoked',()=>{if(!leaving)location.reload()})})()</script>`;
const pageScript = `<script>for(const t of document.querySelectorAll('time[datetime]')){const d=new Date(t.dateTime),minutes=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));t.title=d.toLocaleString();t.textContent=minutes<1?'just now':minutes<60?minutes+' min ago':minutes<1440?Math.floor(minutes/60)+' h ago':d.toLocaleString();}for(const s of document.querySelectorAll('select[name="status"]')){const r=s.form&&s.form.elements.namedItem('reason');if(!(r instanceof HTMLInputElement))continue;const wrap=r.closest('.field')||r;const sync=()=>{const blocked=s.value==='blocked';r.required=blocked;wrap.hidden=!blocked};s.addEventListener('change',sync);sync()}document.addEventListener('click',e=>{const b=e.target instanceof Element&&e.target.closest('[data-copy]');if(!b)return;const input=document.getElementById(b.dataset.copy),out=document.getElementById(b.dataset.copy+'-status');const say=m=>{if(out)out.textContent=m};(navigator.clipboard?navigator.clipboard.writeText(input.value):Promise.reject()).then(()=>say('Link copied.'),()=>{input.select();say('Could not copy automatically. The link is selected: press Ctrl+C or Cmd+C.')})});document.addEventListener('click',e=>{const opener=e.target instanceof Element&&e.target.closest('[data-dialog]');const dialog=opener&&document.getElementById(opener.dataset.dialog);if(!(dialog instanceof HTMLDialogElement)||!dialog.showModal)return;e.preventDefault();dialog.addEventListener('close',()=>opener.focus(),{once:true});dialog.showModal()});for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{if(e.target===d)d.close()})</script>`;
const page = (title: string, body: string, { live, assignee = false, current }: PageOptions = {}) => {
  const isAssignee = assignee || !!live?.startsWith("/l/");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${isAssignee ? '<meta name="robots" content="noindex">' : ""}<title>${esc(title)}${isAssignee ? "" : " · Task assignment"}</title>${themeMarkup}</head><body class="${isAssignee ? "assignee-page" : "assign-page"}"><a class="skip-link" href="#main">Skip to content</a>${isAssignee ? "" : navMarkup({ current })}<main id="main"><h1>${esc(title)}</h1>${body}</main>${live ? liveScript(live) : ""}${pageScript}</body></html>`;
};
const send = (reply: FastifyReply, title: string, body: string, options: PageOptions = {}) => reply.type("text/html; charset=utf-8").send(page(title, body, options));
const redirect = (reply: FastifyReply, path: string) => reply.code(303).header("location", path).send();
const backPath = (request: FastifyRequest) => {
  try { const from = new URL(String(request.headers.referer || "")); if (from.host === request.headers.host && from.pathname !== request.url) return from.pathname + from.search; } catch { /* no usable referer */ }
  return request.url.match(/^\/l\/[A-Za-z0-9]{10}/)?.[0] || "/assign";
};
const fail = (reply: FastifyReply, code: number, message: string) => {
  const assignee = reply.request.url.startsWith("/l/");
  return reply.code(code).type("text/html; charset=utf-8").send(page(code === 404 ? "Not found" : "Couldn't save that", `<p class="error" role="alert">${esc(message)}</p><p><a href="${esc(backPath(reply.request))}">Go back</a></p>`, { assignee }));
};
const STATUSES = ["open", "blocked", "done"] as const;
const statusLabel: Record<TaskStatus, string> = { open: "Open", blocked: "Blocked", done: "Done" };
const badge = (status: TaskStatus) => `<span class="badge ${status}">${statusLabel[status]}</span>`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const timeTag = (at: Date) => `<time datetime="${at.toISOString()}">${at.toISOString().slice(0, 16).replace("T", " ")} UTC</time>`;
const statusForm = (action: string, task: TaskDoc & { _id: ObjectId }) => `<form method="post" action="${action}"><div class="field"><label for="status-${task._id}">Status</label><select id="status-${task._id}" name="status">${STATUSES.map(s => `<option value="${s}"${s === task.status ? " selected" : ""}>${statusLabel[s]}</option>`).join("")}</select></div><div class="field"><label for="reason-${task._id}">What's blocking it?</label><small class="hint" id="reason-${task._id}-hint">Required when the status is Blocked.</small><input id="reason-${task._id}" name="reason" maxlength="2000" aria-describedby="reason-${task._id}-hint"></div><button>Save status</button></form>`;
const noteForm = (action: string, task: TaskDoc & { _id: ObjectId }, hint: string) => `<form method="post" action="${action}"><div class="field"><label for="note-${task._id}">Note</label><small class="hint" id="note-${task._id}-hint">${hint}</small><textarea id="note-${task._id}" name="note" maxlength="2000" aria-describedby="note-${task._id}-hint">${esc(task.note)}</textarea></div><button>Save note</button></form>`;
const deleteListMessage = (active: number, count: number) => `Revokes ${plural(active, "active link")} and returns ${plural(count, "Task")} to Unassigned Tasks. The Tasks themselves are kept.`;
// Native modal: traps focus, closes on Escape. The link still opens the confirmation page when scripts are off.
const confirmDialog = (id: string, title: string, message: string, action: string, button: string) => `<dialog id="${id}" aria-labelledby="${id}-title" aria-describedby="${id}-message"><h2 id="${id}-title">${esc(title)}</h2><p id="${id}-message">${message}</p><form method="post" action="${action}" class="actions"><button class="danger">${button}</button><button type="submit" formmethod="dialog" formnovalidate class="secondary" autofocus>Cancel</button></form></dialog>`;
const confirmDelete = (message: string, button: string, cancel: string) => `<p>${message}</p><form method="post" class="actions"><button class="danger">${button}</button><a href="${cancel}">Cancel</a></form>`;
const ownerOf = async (ctx: AssignContext, request: FastifyRequest, reply: FastifyReply) => {
  const owner = await currentOwner(ctx, request, reply);
  if (!owner) { reply.code(302).header("location", "/assign/login").send(); return null; }
  return owner;
};
const textLimit = (text: string, limit: number) => text.length <= limit;
const tagsFrom = (form: ReturnType<typeof parseForm>) => [...new Set(fields(form, "tags").flatMap(x => x.split(",")).map(x => x.trim().toLowerCase()).filter(Boolean))];
const idFrom = (request: FastifyRequest) => parseId((request.params as Params).id);
const taskLink = (task: TaskDoc & { _id: ObjectId }) => `<a href="/assign/tasks/${task._id}">${esc(task.title)}</a> ${badge(task.status)}`;

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
    const [tasks, lists] = await Promise.all([ctx.store.tasks.find({ ownerId: owner._id, ...(tag ? { tags: tag } : {}) }).sort({ createdAt: -1 }).toArray(), ctx.store.lists.find({ ownerId: owner._id }).toArray()]);
    const listName = (id: ObjectId) => lists.find(l => l._id.equals(id))?.name || "a List";
    const create = `<section><h2>Add a Task</h2><form method="post" action="/assign/tasks"><div class="field"><label for="task-title">Title</label><input id="task-title" name="title" maxlength="200" required></div><div class="field"><label for="task-tags">Tags <span class="hint">(optional)</span></label><small class="hint" id="task-tags-hint">Up to 5, separated by commas. Example: kitchen, urgent</small><input id="task-tags" name="tags" aria-describedby="task-tags-hint"></div><div class="field"><label for="task-instruction">Instructions <span class="hint">(optional)</span></label><small class="hint" id="task-instruction-hint">What the assignee needs to know to get it done.</small><textarea id="task-instruction" name="instruction" maxlength="2000" aria-describedby="task-instruction-hint"></textarea></div><button>Add Task</button></form></section>`;
    const filter = `<form class="filters" role="search" aria-label="Filter Tasks"><div class="field"><label for="tag-filter">Filter by tag</label><input id="tag-filter" name="tag" value="${esc(tag)}"></div><div class="actions"><button>Filter</button>${tag ? '<a href="/assign/tasks">Show all Tasks</a>' : ""}</div></form>`;
    const items = tasks.length ? tasks.map(t => `<article>${taskLink(t)}${t.tags.length ? ` <span class="muted">· ${t.tags.map(esc).join(", ")}</span>` : ""}${t.listId ? ` · In <a href="/assign/lists/${t.listId}">${esc(listName(t.listId))}</a>` : ""}</article>`).join("") : `<p class="empty">${tag ? `No Tasks tagged “${esc(tag)}”.` : "No Tasks yet. Add your first one above."}</p>`;
    return send(reply, "Tasks", `${create}${filter}<h2>${tag ? `Tasks tagged “${esc(tag)}”` : "All Tasks"} (${tasks.length})</h2>${items}`, { live: "/assign/events", current: "/assign/tasks" });
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
    const list = task.listId ? await ctx.store.lists.findOne({ _id: task.listId, ownerId: owner._id }) : null;
    const summary = `<p>${badge(task.status)}${task.blockedReason ? ` ${esc(task.blockedReason)}` : ""}${list ? ` · In <a href="/assign/lists/${list._id}">${esc(list.name)}</a>` : " · Not in a List yet"}</p>`;
    const details = `<section><h2>Details</h2><form method="post" action="/assign/tasks/${task._id}/edit"><div class="field"><label for="edit-title">Title</label><input id="edit-title" name="title" maxlength="200" value="${esc(task.title)}" required></div><div class="field"><label for="edit-tags">Tags</label><small class="hint" id="edit-tags-hint">Up to 5, separated by commas.</small><input id="edit-tags" name="tags" value="${esc(task.tags.join(", "))}" aria-describedby="edit-tags-hint"></div><div class="field"><label for="edit-instruction">Instructions</label><textarea id="edit-instruction" name="instruction" maxlength="2000">${esc(task.instruction)}</textarea></div><button>Save details</button></form></section>`;
    const body = `<a class="back" href="/assign/tasks">← All Tasks</a>${summary}${details}<section><h2>Status</h2>${statusForm(`/assign/tasks/${task._id}/status`, task)}</section><section><h2>Note</h2>${noteForm(`/assign/tasks/${task._id}/note`, task, "The assignee sees this note and can edit it.")}</section><p><a href="/assign/tasks/${task._id}/delete">Delete this Task…</a></p>`;
    return send(reply, task.title, body, { live: "/assign/events", current: "/assign/tasks" });
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
    const choices = tasks.length ? `<fieldset><legend>Tasks to include <span class="hint">(optional, up to 50)</span></legend>${tasks.map(t => `<label><input type="checkbox" name="taskIds" value="${t._id}" ${t.listId ? "disabled" : ""}>${esc(t.title)}${t.listId ? ` <span class="hint">(already in ${esc(lists.find(l => l._id.equals(t.listId!))?.name || "another List")})</span>` : ""}</label>`).join("")}</fieldset>` : `<p class="hint">You have no Tasks yet. You can <a href="/assign/tasks">add Tasks</a> first, or create an empty List and add them later.</p>`;
    const create = `<section><h2>Create a List</h2><p class="hint">A List groups Tasks so you can share them with one person through a single link.</p><form method="post" action="/assign/lists"><div class="field"><label for="list-name">List name</label><input id="list-name" name="name" maxlength="200" required></div>${choices}<button>Create List</button></form></section>`;
    const items = lists.length ? lists.map(l => `<article><a href="/assign/lists/${l._id}">${esc(l.name)}</a> <span class="badge">${l.status === "active" ? "Assigned" : "Draft"}</span> <span class="muted">· ${plural(l.taskCount, "Task")}</span></article>`).join("") : '<p class="empty">No Lists yet.</p>';
    return send(reply, "Lists", `${create}<h2>Your Lists (${lists.length})</h2>${items}`, { live: "/assign/events", current: "/assign/lists" });
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
    const [tasks, free, assignment, people] = await Promise.all([ctx.store.tasks.find({ ownerId: owner._id, listId: list._id }).toArray(), ctx.store.tasks.find({ ownerId: owner._id, listId: { $exists: false } }).toArray(), ctx.store.assignments.findOne({ ownerId: owner._id, listId: list._id, active: true }), ctx.store.people.find({ ownerId: owner._id }).toArray()]);
    const assignee = assignment && people.find(p => p._id.equals(assignment.personId));
    const done = tasks.filter(t => t.status === "done").length;
    const shared = assignment ? `<p>Assigned to <strong>${esc(assignee?.name || "someone")}</strong> · ${assignment.lastViewedAt ? `Last opened ${timeTag(assignment.lastViewedAt)}` : "Not opened yet"}</p><div class="field"><label for="share-link">Link to send ${esc(assignee?.name || "them")}</label><div class="copy-row"><input id="share-link" readonly value="${esc(ctx.config.publicUrl)}/l/${assignment.code}"><button type="button" data-copy="share-link">Copy link</button></div><small class="hint" id="share-link-status" role="status"></small></div><form method="post" action="/assign/lists/${list._id}/revoke"><p class="hint">Revoking stops this link from working straight away. The Tasks stay in the List.</p><button class="danger">Revoke link</button></form>` : '<p class="hint">Not assigned yet. Assign it to get a link you can send.</p>';
    const assign = `<form method="post" action="/assign/lists/${list._id}/assign"><div class="field"><label for="person">${assignment ? "Reassign to" : "Assign to"}</label><small class="hint" id="person-hint">${assignment ? "Reassigning revokes the current link and makes a new one." : "Type a name. New names are added to People."}</small><input id="person" name="person" maxlength="200" list="people-names" autocomplete="off" aria-describedby="person-hint" required><datalist id="people-names">${people.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist></div><button>${assignment ? "Reassign" : "Assign"}</button></form>`;
    const rows = tasks.length ? tasks.map(t => `<article class="row"><span>${taskLink(t)}</span><form method="post" action="/assign/lists/${list._id}/remove"><input type="hidden" name="taskId" value="${t._id}"><button class="secondary" aria-label="Remove ${esc(t.title)} from this List">Remove</button></form></article>`).join("") : '<p class="empty">No Tasks in this List yet.</p>';
    const add = free.length ? `<form method="post" action="/assign/lists/${list._id}/add"><div class="field"><label for="add-task">Add a Task</label><select id="add-task" name="taskId">${free.map(t => `<option value="${t._id}">${esc(t.title)}</option>`).join("")}</select></div><button>Add Task</button></form>` : '<p class="hint">Every Task is already in a List. <a href="/assign/tasks">Create a new Task</a> to add one here.</p>';
    const rename = `<form method="post" action="/assign/lists/${list._id}/edit"><div class="field"><label for="list-rename">List name</label><input id="list-rename" name="name" value="${esc(list.name)}" maxlength="200" required></div><button>Rename</button></form>`;
    const body = `<a class="back" href="/assign/lists">← All Lists</a><section><h2>Sharing</h2>${shared}${assign}</section><section><h2>Tasks <span class="muted">(${done} of ${tasks.length} done)</span></h2>${rows}${add}</section><section><h2>Rename</h2>${rename}</section><p><a href="/assign/lists/${list._id}/delete" data-dialog="delete-list" aria-haspopup="dialog">Delete this List…</a></p>${confirmDialog("delete-list", `Delete ${list.name}?`, deleteListMessage(assignment ? 1 : 0, tasks.length), `/assign/lists/${list._id}/delete`, "Delete List")}`;
    return send(reply, list.name, body, { live: "/assign/events", current: "/assign/lists" });
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
    if (!assignment) return send(reply, "Link no longer available", "<p>This link has been revoked or replaced.</p><p class=\"hint\">If you still need these Tasks, ask the person who sent you the link for a new one.</p>", { assignee: true });
    const [list, person, tasks] = await Promise.all([ctx.store.lists.findOne({ _id: assignment.listId, ownerId: assignment.ownerId }), ctx.store.people.findOne({ _id: assignment.personId, ownerId: assignment.ownerId }), ctx.store.tasks.find({ ownerId: assignment.ownerId, listId: assignment.listId }).toArray()]);
    if (!list || !person) return fail(reply, 404, "Link no longer available.");
    const showTask = (t: TaskDoc & { _id: ObjectId }) => `<article><h3>${esc(t.title)}</h3><p>${badge(t.status)}${t.blockedReason ? ` ${esc(t.blockedReason)}` : ""}${t.tags.length ? ` <span class="muted">· ${t.tags.map(esc).join(", ")}</span>` : ""}</p>${t.instruction ? `<p class="instruction">${esc(t.instruction)}</p>` : ""}${statusForm(`/l/${code}/tasks/${t._id}/status`, t)}${noteForm(`/l/${code}/tasks/${t._id}/note`, t, "Leave a note for the person who assigned this.")}</article>`;
    const done = tasks.filter(t => t.status === "done"), pending = tasks.filter(t => t.status !== "done");
    const todo = pending.length ? pending.map(showTask).join("") : `<p class="empty">${tasks.length ? "Everything here is done. Nice work!" : "There are no Tasks in this List yet."}</p>`;
    const body = `<p class="muted">Assigned to ${esc(person.name)} · ${done.length} of ${tasks.length} done</p>${todo}${done.length ? `<details><summary>Done (${done.length})</summary>${done.map(showTask).join("")}</details>` : ""}<script>navigator.sendBeacon('/l/${code}/view',new Blob([], {type:'text/plain'}))</script>`;
    return send(reply, list.name, body, { live: `/l/${code}/events` });
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
    const filtered = Boolean(query.person || query.tag || query.status);
    const sections = people.filter(p => !query.person || p._id.toHexString() === query.person).map(p => {
      const mine = assignments.filter(a => a.personId.equals(p._id) && ((!query.tag && !query.status) || tasks.some(t => t.listId?.equals(a.listId) && shown(t))));
      const cards = mine.map(a => { const list = lists.find(l => l._id.equals(a.listId)); const all = tasks.filter(t => t.listId?.equals(a.listId)); const visible = all.filter(shown); return `<article><a href="/assign/lists/${a.listId}">${esc(list?.name)}</a> · ${all.filter(t => t.status === "done").length} of ${all.length} done · ${a.lastViewedAt ? `Viewed ${timeTag(a.lastViewedAt)}` : "Not opened yet"}${visible.length ? `<ul class="task-lines">${visible.map(t => `<li><span class="${t.status}">${esc(t.title)}</span> ${badge(t.status)}${t.blockedReason ? ` ${esc(t.blockedReason)}` : ""}</li>`).join("")}</ul>` : ""}</article>`; }).join("");
      return `<section><h2>${esc(p.name)}</h2>${cards || `<p class="empty">${filtered ? "Nothing matches these filters." : "No active Lists."}</p>`}</section>`;
    }).join("");
    const unassigned = query.person ? [] : tasks.filter(t => !t.listId && shown(t));
    const drafts = query.person ? [] : lists.filter(l => l.status === "draft" && ((!query.tag && !query.status) || tasks.some(t => t.listId?.equals(l._id) && shown(t))));
    const option = (value: string, label: string, current?: string) => `<option value="${esc(value)}"${value === (current || "") ? " selected" : ""}>${esc(label)}</option>`;
    const filters = `<form class="filters" role="search" aria-label="Filter the Board"><div class="field"><label for="filter-person">Person</label><select id="filter-person" name="person">${option("", "All people", query.person)}${people.map(p => option(p._id.toHexString(), p.name, query.person)).join("")}</select></div><div class="field"><label for="filter-tag">Tag</label><input id="filter-tag" name="tag" value="${esc(query.tag || "")}"></div><div class="field"><label for="filter-status">Status</label><select id="filter-status" name="status">${option("", "All statuses", query.status)}${STATUSES.map(s => option(s, statusLabel[s], query.status)).join("")}</select></div><div class="actions"><button>Filter</button>${filtered ? '<a href="/assign">Clear filters</a>' : ""}</div></form>`;
    const welcome = !tasks.length && !lists.length ? '<section><h2>Get started</h2><ol><li><a href="/assign/tasks">Add Tasks</a> you want done.</li><li><a href="/assign/lists">Group them into a List</a>.</li><li>Assign the List to someone and send them its link. Their progress shows up here.</li></ol></section>' : "";
    const body = `${welcome}${filters}<p><a href="/assign/feed">Activity (${unread} unread)</a></p>${sections}${query.person ? "" : `<section><h2>Draft Lists</h2>${drafts.map(l => `<p><a href="/assign/lists/${l._id}">${esc(l.name)}</a> <span class="muted">· not assigned yet</span></p>`).join("") || `<p class="empty">${filtered ? "Nothing matches these filters." : "No draft Lists."}</p>`}</section><section><h2>Unassigned Tasks</h2>${unassigned.map(t => `<p>${taskLink(t)}</p>`).join("") || `<p class="empty">${filtered ? "Nothing matches these filters." : tasks.length ? "Every Task is in a List." : "No Tasks yet."}</p>`}</section>`}`;
    return send(reply, "Board", body, { live: "/assign/events", current: "/assign" });
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
    const items = events.map(e => `<article>${e.seq > owner.lastSeenEventId ? '<span class="badge new">New</span> ' : ""}${esc(describe(e))} <span class="muted">· ${timeTag(e.createdAt)}</span></article>`).join("");
    return send(reply, "Activity", items || '<p class="empty">No activity yet. Changes to your Tasks and Lists, and updates from the people you assign, show up here.</p>', { live: "/assign/events", current: "/assign/feed" });
  });
  app.get("/assign/people", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const people = await ctx.store.people.find({ ownerId: owner._id }).toArray();
    const body = (await Promise.all(people.map(async p => `<article class="row"><span><strong>${esc(p.name)}</strong> <span class="muted">· ${plural(await ctx.store.assignments.countDocuments({ ownerId: owner._id, personId: p._id, active: true }), "active link")}</span></span><a href="/assign/people/${p._id}/delete" aria-label="Delete ${esc(p.name)}">Delete…</a></article>`))).join("");
    return send(reply, "People", body || '<p class="empty">No people yet. People are added when you <a href="/assign/lists">assign a List</a> to someone.</p>', { current: "/assign/people" });
  });
  app.get("/assign/tasks/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const task = await ownTask(ctx, owner, request); if (!task) return fail(reply, 404, "Task not found.");
    const assignment = task.listId ? await ctx.store.assignments.findOne({ ownerId: owner._id, listId: task.listId, active: true }) : null;
    const person = assignment ? await ctx.store.people.findOne({ _id: assignment.personId, ownerId: owner._id }) : null;
    return send(reply, `Delete ${task.title}?`, confirmDelete(`This can't be undone.${person ? ` It also removes the Task from ${esc(person.name)}'s link.` : ""}`, "Delete Task", `/assign/tasks/${task._id}`), { current: "/assign/tasks" });
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
    return send(reply, `Delete ${list.name}?`, confirmDelete(deleteListMessage(active, count), "Delete List", `/assign/lists/${list._id}`), { current: "/assign/lists" });
  });
  app.post("/assign/lists/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const list = await ownList(ctx, owner, request); if (!list) return fail(reply, 404, "List not found.");
    await ctx.store.assignments.updateMany({ ownerId: owner._id, listId: list._id, active: true }, { $set: { active: false, revokedAt: ctx.now() } });
    await ctx.store.tasks.updateMany({ ownerId: owner._id, listId: list._id }, { $unset: { listId: "" } }); await ctx.store.lists.deleteOne({ _id: list._id, ownerId: owner._id });
    await recordEvent(ctx, owner._id, "list.delete", { listId: list._id }); return redirect(reply, "/assign/lists");
  });
  app.get("/assign/people/:id/delete", async (request, reply) => {
    const owner = await ownerOf(ctx, request, reply); if (!owner) return; const id = idFrom(request); const person = id && await ctx.store.people.findOne({ _id: id, ownerId: owner._id }); if (!person) return fail(reply, 404, "Person not found.");
    const count = await ctx.store.assignments.countDocuments({ ownerId: owner._id, personId: person._id, active: true }); return send(reply, `Delete ${person.name}?`, confirmDelete(`Revokes ${plural(count, "active link")}. Their Lists go back to drafts and keep their Tasks.`, "Delete Person", "/assign/people"), { current: "/assign/people" });
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
