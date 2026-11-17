# The office's team chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chat button in the office's header opens upstream's team chat beside the floor: one conversation kept by the office's server, agents posting about their work, banter, reactions and polls, and an @mention that prompts the agent and brings its answer back.

**Architecture:** Upstream's `chat-engine.js` is vendored unchanged and runs on the plugin's server, made once with a `ctx` the new `server/chat-service.ts` builds: members from the directory's last view, events from the directory's changes and the daemon's turn hooks, storage in `<PASEO_HOME>/office/chat.json`. The hub sends the conversation in `office.state` (a `chat` field on the snapshot, a `chat` event for each change). A new React panel reads it through the office link's side-area pattern from piece 3. Prompts go to agents with `send(agentId, prompt, null)` (steer), and the answer is the last assistant message of the turn, read from the timeline when the turn-end hook fires.

**Tech Stack:** TypeScript, zod, React Native (react-native-web in a browser), vitest with jsdom for mounted tests, the plugin kit (`@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`), upstream's plain-JS engine.

**Spec:** `docs/superpowers/specs/2026-11-17-office-team-chat-design.md` (piece 5 of sub-project 7 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`). The header buttons and the side area it uses are piece 3, `docs/superpowers/plans/2026-11-17-office-side-panels.md`, already on `main`.

## Global Constraints

- Work in your own worktree on a new branch off main: `git -C /workspace/QFlavours/paseo-onepage-docs worktree add /workspace/QFlavours/paseo-team-chat -b feat/office-team-chat main`. Link `node_modules` from `/workspace/QFlavours/paseo` (the root one, each package's, and `plugins/node_modules`) as symlinks. Do not write in `/workspace/QFlavours/paseo` or in any other worktree. Do not push.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line. Commit messages read `feat(office): ...`. Commits run the pre-commit hook (it typechecks the whole repo); do not skip it.
- Run one test file at a time, from `plugins/`: `cd plugins && npx vitest run office/server/chat-service.test.ts --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files>`, then `npm run format:files -- <changed files>`.
- Nothing in `packages/` changes. The office's wire schemas are its own (`plugins/office/shared/contracts.ts`); the protocol rules do not apply, but the RPC name follows `docs/rpc-namespacing.md`. Server code cannot import from `client/`; shared code goes in `shared/`. The plugin cannot import `@getpaseo/protocol`.
- `vendor/my-office/src/shared/chat-engine.js` and the `chat` locale area are upstream's, copied by `import-upstream.mjs`, never edited by hand.
- Never restart or touch the daemon on port 6767. No real agent is created or prompted: tests use fakes. The live check in Task 6 uses a dev daemon of this worktree.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are. They are the plan's code: where typecheck or lint finds drift from the real types, fix the code and keep the names the later tasks use.
- Doc voice for every doc and comment: plain and short (CLAUDE.md, "Doc voice").

Binding values from the spec:

- Engine file: `vendor/my-office/src/shared/chat-engine.js`, upstream's, unchanged. `import-upstream.mjs` copies it and the English `chat` area. One engine, made when the office's server starts, before any page subscribes.
- Team: `members()` is the office's agents that are not archived: `name` is the name the floor shows (a sub-agent's is "Mjd-1"), `status` is `rest` when idle and `work` otherwise, `task` is its title, `project` is its folder's name.
- Staff: `staffName` names the director only (upstream's English "Director"); every other key returns null, so reception, HR, the cleaner, the guard, the courier and the accountant are silent. The lunch poll still comes, from an agent.
- Storage: `<PASEO_HOME>/office/chat.json`, saved through the board store's queued save that swaps into place. A file that does not parse is moved aside and the chat starts empty. Upstream's limit: 300 messages.
- `office.state`: the snapshot carries `chat: { messages, typing }`. `emit` puts a `chat` change in the stream: `{ op: "add" | "update", message }`, `{ op: "typing", names }`, `{ op: "all" }` followed by the whole conversation.
- `act`: `meeting` asks the open scenes to gather people at the bell (`ringBell` in `people/gatherings.js`) without `host.bell`, so the stand-up notes writer does not start. `tea` does nothing.
- Clock: `clock()` every 30 s.
- Engine events: an agent appears `start`; a turn ends `stop`; a permission waits `wait`, a question `ask`; a turn ends in an error `fail` (`limit` when the error is a usage limit); a sub-agent appears `substart` with `agent` on its parent; an agent is archived `onLeft`. `prompt` is never sent.
- Call: `office.chat.request` with `op`: `send { text, sticker?, replyTo? }`, `react { id, emoji }`, `vote { id, index }`, `rsvp { id, yes }`, `recall { id }`, each to the engine's function of that name.
- Prompt: for each `@Name` in the text that is a member, `Team chat message from you: <text>` to that agent with `send(agentId, prompt, null)`. One message to two agents is two prompts. An archived agent matches nobody.
- Typing: `working(agentId, true)` from the send until that agent's turn ends.
- Answer: when the turn ends, the last assistant message is read from the timeline tail and posted with `say(agentId, text, { now: true, long: true, reply })`, `reply` quoting your message, clipped to 1,200 characters with "…". A turn that ends in an error posts nothing more. A prompt waiting for its answer is kept in memory only.
- Errors: a save that fails is logged and the next save tries again; a prompt that fails to send gives the system line `Could not reach <name>: <error>.`; an answer that cannot be read posts nothing and the agent stops typing.
- Button: Chat (`message-circle`), after Activity, hidden without `showBeside`; a count of messages since the chat was last open, kept per device in `localStorage` under `office-chat-seen`; none at zero; a press calls `showBeside` with the chat screen.
- Messages: oldest first, scrolled to the newest and kept there while you are at the bottom. Round avatar with the person's initials in their floor colour (the director's is upstream's), the name and the time; yours on the right without an avatar. A reply quotes the message it answers. A system line is centred and small.
- Kinds: text; a sticker (upstream's English words) as a chip; a poll with its options, counts and your vote, a press votes; a reminder with its time and Going / Not going; a recalled message as `Message recalled`. A photo, work, loop, CI or denied message never comes; one in the file shows nothing.
- An agent's answer: clipped at eight lines with `Show more`; `Open session` opens the agent beside the floor, as the agent card does.
- Reactions: upstream's six under a message, each with its count, your own pressed; `React` on a message (shown on hover and focus on web, always on a phone) opens the six; the same emoji again takes it back.
- Typing words: `<name> is typing…`, `<a> and <b> are typing…`, `Several people are typing…`, above the box.
- Box: multi-line; Enter sends, Shift+Enter is a new line; `@` lists the team, filtered by the words after it with the List's search (`list-text.ts`); Enter, Tab or a press puts `@Name `; a counter shows from 500 of 600 characters; a sticker button opens the eight stickers; Reply on a message quotes it above the box; your own message can be recalled for two minutes.
- Empty: `No messages yet. @ an agent to give it work.` A call that fails leaves the text in the box and shows the error under it.
- Not built: photos, starting a poll, pins, the task sheet, the vault, the burn chart, CI, loop and denied cards, voice, push notifications, prompt rewriting, chibi avatars, answers after a daemon restart.

Decided in this plan, where the spec left it open (each is also in the report that came with this plan):

- The chat screen is `office-chat`, beside `office-sessions` and `office-activity` in `client/office-link.ts`.
- `meeting` reaches the scenes as a fifth change, `{ op: "act", what: "meeting", id }`. The spec lists four changes and no way for an act to leave the server. The client drops an act it already saw by `id`, because the surface and each open panel have their own subscription.
- The world gets `gather()`, as the spec says. `meet()` already rings the same bell for the stand-up card; `gather()` differs in the opening line (upstream's default, not the stand-up's). `meet()` stays as it is.
- The first view of each open office is a baseline: agents already there make no `start`. The roster is kept when the last office closes, so a turn that ends with no office open still gets its line and its answer. Nothing else is derived while no office is open.
- Turn ends come from the `agent.turn.after` hook (it has the outcome, the error and the turn id); appears, permissions and sub-agents come from the directory's view; leaving comes from `agent.archive.after`. A turn that was cancelled posts nothing and stops the typing.
- An agent whose runtime is `closed` is not a member: the floor does not show it and the board's wake counts it gone.
- A prompt names an agent by upstream's own rule (`text.includes("@" + name)`) except that a name followed by a name character, or inside a longer member's name, does not count: `@Mjd-1` does not prompt `Mjd`. The engine's own status replies keep upstream's rule.
- A usage limit is an error message that matches `/usage limit|rate limit|quota|limit (reached|exceeded|resets)|out of (usage|credits)/i`.
- The chat's own writes use mode 0o600 (prompts and answers can hold secrets), as `incidents.json` does.
- Saves are coalesced: while one write is in flight only the newest conversation waits behind it. Upstream saves on every reaction, and reactions come in bursts.
- Recall: the server refuses a recall of a message older than two minutes, so the rule holds for any client.
- The client keeps the chat apart from the floor's state (`useOffice().chat`): a typing or reaction change must not rebuild the floor's model and re-send the 3D scene's people.
- The `@` list reads the text up to its end (the caret is taken to be at the end), and matches with `matchesQuery` over the office model's rows.
- A Send button sits beside the box: on a phone Enter is a new line, so Enter alone cannot send there.
- A first-ever open of the chat on a device counts from that moment, not from the file's 300 old messages.

## Files shared with other branches

| File                                              | Also edited by                       | How to keep the merge small                                                                          |
| ------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `plugins/office/shared/contracts.ts`              | other pieces that add state          | One block named for the chat after the incidents block; one field on the snapshot; one event.        |
| `plugins/office/server/hub.ts`                    | other pieces that add state          | Three methods and one line in `snapshot()`, `onDirectory` and `idle`; nothing else.                  |
| `plugins/office/index.server.ts`                  | other pieces                         | One block after the incidents block; one line in two hooks; one handler line.                        |
| `plugins/office/client/office-surface.tsx`        | piece 4 (walk in)                    | `PanelButton` gains an optional count; one more button in `PanelButtons`; no other change.           |
| `plugins/office/client/use-office.ts`             | none                                 | The chat part of `onEvent` only.                                                                     |
| `plugins/office/client/world/world-api.ts`, `vendor/my-office/src/office/paseo-entry.js` | piece 4 (walk in) | `gather` is its own method beside `meet`; touch no other line.                                       |
| `plugins/office/vendor/SOURCES.md`, `import-upstream.mjs` | later upstream imports      | One paragraph in SOURCES.md; one `visit` line in the importer.                                       |

Not touched by this plan: `packages/`, `board-service.ts`, `board-store.ts`, `mention-queue.ts`, `activity.ts`, `paseo-directory.ts`.

## Review Focus

1. **The engine's save and emit run inside its constructor.** Both are called before `createChatEngine` returns. The service must not touch `engine` from either until it is made. Pinned in Task 3.
2. **`working(id, false)` needs the member.** The engine's `who()` returns nothing for an agent that left, so typing would stay on forever. Every path that ends a wait clears typing while the agent is still a member. Pinned in Task 3 (turn ended, archived, send failed).
3. **A turn that ends with no office open.** The answer still comes, from the member kept with the waiting prompt. Pinned in Task 3.
4. **Engine timers.** The engine calls the global `clearTimeout` on a handle our clock does not return, so stale tick timers are not cancelled; they stop when the queue drains. Pinned in Task 3: after the banter ends only the 30 s clock is pending, and `stop()` leaves none.
5. **A chat change must not rebuild the floor.** Pinned in Task 2 (the floor's reducer ignores a chat event) and Task 6 (a mounted check that a chat event does not call `buildOfficeModel` again).
6. **A second `@` name that is a prefix of the first.** One prompt, not two. Pinned in Task 3.
7. **Vendored JS under `allowJs: false`.** The engine, the locale area and the i18n stand-in get `.d.ts` files beside them; the plugin compile test builds the entry. Pinned in Task 1 and Task 4.

---

### Task 1: Take the engine and its words

Can run in parallel with Task 2.

**Files:**

- Modify: `plugins/office/vendor/my-office/import-upstream.mjs`
- Create (by the importer): `plugins/office/vendor/my-office/src/shared/chat-engine.js`, `plugins/office/vendor/my-office/src/i18n/locales/en/chat.js`
- Modify (by the importer): `plugins/office/vendor/my-office/src/i18n/locales/en/index.js`, `plugins/office/vendor/my-office/MANIFEST.json`
- Create: `plugins/office/vendor/my-office/src/shared/chat-engine.d.ts`, `plugins/office/vendor/my-office/src/i18n/locales/en/chat.d.ts`, `plugins/office/vendor/my-office/src/i18n/index.d.ts`
- Modify: `plugins/office/vendor/SOURCES.md`
- Test: `plugins/office/vendor/my-office/chat-engine.vendor.test.ts` (a small smoke test of the copied engine through its types)

**Interfaces:**

- Produces (in `chat-engine.d.ts`), used by Tasks 3, 5 and 6:

```text
export const REACTIONS: string[];
export type Translate = {
  (key: string, vars?: object | null): string;
  (key: string, vars: object | null, as: "list"): string[];
};
export interface EngineMessage {
  id: string; at: number; kind: string; text: string;
  from?: string; name?: string; sticker?: number | null; photo?: unknown;
  poll?: { q: string; opts: { t: string; by: string[] }[] } | null;
  remind?: { title: string; at: number; repeat: string; yes: string[]; no: string[]; done?: boolean } | null;
  reply?: { id: string; name: string; text: string } | null;
  reacts: Record<string, string[]>;
  recalled?: boolean; tag?: string;
}
export interface ChatMember { id: string; name: string; status: "rest" | "work"; task: string; project: string; last?: { type?: string; label?: string } }
export interface ChatEngineContext {
  tr: Translate;
  now(): number;
  members(): ChatMember[];
  staffName(key: string): string | null;
  store: { load(): unknown; save(data: unknown): void };
  emit(op: "add" | "update" | "typing" | "all", payload?: EngineMessage | string[]): void;
  act?(what: "meeting" | "tea"): void;
  timer?(run: () => void, ms: number): unknown;
}
export interface SayOptions { now?: boolean; delay?: number; long?: boolean; reply?: { id: string; name: string; text: string } | null; sticker?: number | null; react?: string[]; reacts?: number; key?: string; tag?: string }
export interface ChatEngine {
  state: { msgs: EngineMessage[]; pinned: string | null; days: Record<string, string>; keys: string[]; typing: string[] };
  byId(id: string): EngineMessage | undefined;
  say(from: string, text: string, options?: SayOptions): void;
  system(text: string): EngineMessage;
  send(input: { text?: string; sticker?: number | null; replyTo?: string | null }): void;
  working(from: string, on: boolean): void;
  react(id: string, by: string, emoji: string): void;
  vote(id: string, by: string, index: number): void;
  rsvp(id: string, by: string, yes: boolean): void;
  recall(id: string): void;
  onEvent(event: { type: string; sess: string; agent?: boolean; limit?: boolean; label?: string }): void;
  onLeft(name: string): void;
  clock(): void;
}
export function createChatEngine(context: ChatEngineContext): ChatEngine;
```

- Produces: `chat.d.ts` declares `declare const chat: { stickers: string[] }; export default chat;`. `index.d.ts` declares `export const t: Translate;` (imported from `shared/chat-engine.js`'s types) beside `num`, `lang`, `locale`, `createT`, `DEFAULT_LANG`.

- [ ] **Step 1: See what the importer does now**

Run: `node plugins/office/vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check`
Expected: `would write: 0, unchanged: 103`, `english areas: common time ui settings fp activity incident events people places props world life`. If `/tmp/ref-office` is missing, clone it as `vendor/SOURCES.md` says, at the commit `b68228871fe30cd2c759a2c919337a9a9d1f5644`.

- [ ] **Step 2: Write the failing smoke test**

```text
// plugins/office/vendor/my-office/chat-engine.vendor.test.ts
import { expect, test } from "vitest";
import { createChatEngine, REACTIONS, type EngineMessage } from "./src/shared/chat-engine.js";
import { t } from "./src/i18n/index.js";
import chat from "./src/i18n/locales/en/chat.js";

test("the vendored engine makes its first line and speaks upstream's English", () => {
  const added: EngineMessage[] = [];
  createChatEngine({
    tr: t, now: () => 0, members: () => [], staffName: () => null,
    store: { load: () => null, save: () => undefined },
    emit: (op, payload) => { if (op === "add" && payload && !Array.isArray(payload)) added.push(payload); },
  });
  expect(REACTIONS).toHaveLength(6);
  expect(chat.stickers).toHaveLength(8);
  expect(t("chat.stickers", null, "list")).toEqual(chat.stickers);
  expect(t("chat.boss")).toBe("Boss");
});
```

Run: `cd plugins && npx vitest run office/vendor/my-office/chat-engine.vendor.test.ts --bail=1`
Expected: FAIL, the files are not there. (The emit of the first line happens inside the constructor, so `added` is not asserted: that is Review Focus 1.)

- [ ] **Step 3: Teach the importer to take the engine**

In `import-upstream.mjs`, after the line `for (const rel of ["i18n/locales/en/common.js", "i18n/locales/en/time.js"]) visit(rel);` add:

```text
// The team chat's engine runs on the plugin's server, not in the scene, so nothing in the start-up list reaches it.
// Its `tr('chat.…')` calls name the `chat` area, so the area is taken with the other English areas below.
visit("shared/chat-engine.js");
```

and in the header comment's DENY paragraph change "upstream's panels, chat, replay" to "upstream's panels, chat window, replay". The area is chosen by the regex over every taken file's text, which now includes the engine's `'chat.sys.created'`; no other change is needed.

- [ ] **Step 4: Check, then take**

Run the `--check` command from Step 1.
Expected: `would write: 3` (the engine, `chat.js`, the regenerated locale index) and `english areas: ... life chat`. Then run it without `--check`. `git status` shows `chat-engine.js`, `chat.js`, `en/index.js` and `MANIFEST.json` changed or new, and nothing else under `vendor/`. `git diff plugins/office/vendor/my-office/MANIFEST.json` adds exactly two `files` entries and `standIns` is unchanged.

- [ ] **Step 5: Write the three declaration files**

Write `chat-engine.d.ts` with the types in Interfaces above, `chat.d.ts` and `i18n/index.d.ts` as described. Start each with `// PASEO: types for <file>.js, which is upstream's (or Paseo's stand-in) and stays as it is.` The importer never touches a `.d.ts`.

- [ ] **Step 6: Say what is taken**

In `vendor/SOURCES.md`, under "What is taken", add a paragraph: the team chat's engine (`src/shared/chat-engine.js`, unchanged) and the English `chat` area are taken for the office's server, which imports them (`server/chat-service.ts`); the scene does not. Say the three `.d.ts` files exist because the plugin compiles with `allowJs` off. Under "What is not taken", say the chat's window (`ui/group-chat*.js`), its CI, loop and denied cards, voice, push and prompt rewriting are not taken, and which staff upstream's engine names stay silent (reception, HR, the cleaner, the guard, the courier, the accountant) and which does not (the director). Say the engine's morning hello, Monday and Friday reminders therefore never come, and its `tea` act does nothing.

- [ ] **Step 7: Run the smoke test and the world build**

Run: `cd plugins && npx vitest run office/vendor/my-office/chat-engine.vendor.test.ts --bail=1`
Expected: PASS.
Run: `cd plugins && npx vitest run office/server/world-script.test.ts --bail=1`
Expected: PASS (the scene's bundle still builds with the larger locale index).
Run: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, the lint and the format commands on the test file and the `.d.ts` files.

- [ ] **Step 8: Commit**

```bash
git add plugins/office/vendor
git commit -m "feat(office): take upstream's chat engine and its English words"
```

---

### Task 2: The contracts, the file, the client state

Can run in parallel with Task 1.

**Files:**

- Modify: `plugins/office/shared/contracts.ts` (a chat block after the incidents block; `chat` on `OfficeSnapshotSchema`; a `chat` event in `OfficeEventSchema`; `chatRpc` at the end of the calls)
- Create: `plugins/office/server/chat-store.ts`
- Modify: `plugins/office/server/paths.ts` (`chatFile`)
- Modify: `plugins/office/client/office-state.ts` (a chat reducer)
- Test: `plugins/office/shared/contracts.test.ts`, `plugins/office/server/chat-store.test.ts`, `plugins/office/server/paths.test.ts`, `plugins/office/client/office-state.test.ts`

**Interfaces:**

- Produces in `contracts.ts`:

```text
export const CHAT_TEXT_MAX = 600;
export const CHAT_MESSAGE_MAX = 300;
export const ChatReplySchema = z.object({ id: z.string(), name: z.string(), text: z.string() });
export const ChatPollSchema = z.object({ q: z.string(), opts: z.array(z.object({ t: z.string(), by: z.array(z.string()) })) });
export const ChatRemindSchema = z.object({ title: z.string(), at: z.number(), repeat: z.string(), yes: z.array(z.string()), no: z.array(z.string()), done: z.boolean().optional() });
export const ChatMessageSchema = z.object({
  id: z.string(), at: z.number(),
  /** "text", "sticker", "poll", "remind" and "sys" show; the engine has more kinds, which the office never shows. */
  kind: z.string(),
  /** An agent id, "me", or a staff key like "__director"; absent on a system line. */
  from: z.string().optional(), name: z.string().optional(),
  text: z.string(),
  sticker: z.number().int().nullable().optional(),
  poll: ChatPollSchema.nullable().optional(), remind: ChatRemindSchema.nullable().optional(), reply: ChatReplySchema.nullable().optional(),
  reacts: z.record(z.string(), z.array(z.string())),
  recalled: z.boolean().optional(),
});
export const ChatSnapshotSchema = z.object({ messages: z.array(ChatMessageSchema), typing: z.array(z.string()) });
export const ChatChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), message: ChatMessageSchema }),
  z.object({ op: z.literal("update"), message: ChatMessageSchema }),
  z.object({ op: z.literal("typing"), names: z.array(z.string()) }),
  z.object({ op: z.literal("all"), messages: z.array(ChatMessageSchema) }),
  z.object({ op: z.literal("act"), what: z.literal("meeting"), id: z.string() }),
]);
export const ChatRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("send"), text: z.string().max(CHAT_TEXT_MAX).optional(), sticker: z.number().int().min(0).optional(), replyTo: z.string().min(1).optional() }),
  z.object({ op: z.literal("react"), id: z.string().min(1), emoji: z.string().min(1) }),
  z.object({ op: z.literal("vote"), id: z.string().min(1), index: z.number().int().min(0) }),
  z.object({ op: z.literal("rsvp"), id: z.string().min(1), yes: z.boolean() }),
  z.object({ op: z.literal("recall"), id: z.string().min(1) }),
]);
export const ChatResultSchema = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })]);
export const chatRpc = defineRpc({ name: "office.chat.request", input: ChatRequestSchema, output: ChatResultSchema });
// OfficeSnapshotSchema: chat: ChatSnapshotSchema.optional()
// OfficeEventSchema: z.object({ type: z.literal("chat"), change: ChatChangeSchema })
// types: ChatMessage, ChatSnapshot, ChatChange, ChatRequest, ChatResult (z.output of each)
```

- Produces in `chat-store.ts`: `ChatFileSchema`, `type ChatData = { v: 1; msgs: ChatMessage[]; pinned: string | null; days: Record<string, string>; keys: string[] }`, `emptyChat(): ChatData`, `interface ChatStore { load(): Promise<ChatData>; save(data: ChatData): Promise<void> }`, `createChatStore(options: { file: string; now(): number; log(message: string): void }): ChatStore`.
- Produces in `paths.ts`: `chatFile(env, home): string`.
- Produces in `office-state.ts`: `EMPTY_CHAT: ChatSnapshot`, `applyChatEvent(chat: ChatSnapshot | null, event: OfficeEvent): ChatSnapshot | null`, and `applyOfficeEvent` returning the state unchanged for a `chat` event.

- [ ] **Step 1: Write the failing tests**

In `contracts.test.ts`:

```text
test("the chat call names its RPC and takes each op", () => {
  expect(chatRpc.name).toBe("office.chat.request");
  for (const input of [
    { op: "send", text: "@Alice hi", replyTo: "m1" }, { op: "send", sticker: 3 },
    { op: "react", id: "m1", emoji: "👍" }, { op: "vote", id: "m1", index: 0 },
    { op: "rsvp", id: "m1", yes: true }, { op: "recall", id: "m1" },
  ]) expect(ChatRequestSchema.safeParse(input).success).toBe(true);
  expect(ChatRequestSchema.safeParse({ op: "send", text: "x".repeat(601) }).success).toBe(false);
  expect(ChatRequestSchema.safeParse({ op: "pin", id: "m1" }).success).toBe(false);
});
test("a snapshot and an event carry the chat, and a snapshot parses without it", () => {
  const message = { id: "m1", at: 1, kind: "text", from: "me", name: "Boss", text: "hi", reacts: {} };
  const chat = { messages: [message], typing: ["Alice"] };
  expect(OfficeSnapshotSchema.parse({ ...emptySnapshot(), chat }).chat).toEqual(chat);
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).chat).toBeUndefined();
  for (const change of [
    { op: "add", message }, { op: "update", message }, { op: "typing", names: [] },
    { op: "all", messages: [message] }, { op: "act", what: "meeting", id: "a1" },
  ]) expect(OfficeEventSchema.parse({ type: "chat", change })).toEqual({ type: "chat", change });
});
test("a system line has no sender", () => {
  expect(ChatMessageSchema.parse({ id: "s", at: 1, kind: "sys", text: "created", reacts: {} }).from).toBeUndefined();
});
```

In `paths.test.ts` add `expect(chatFile(env, HOME)).toBe("/srv/paseo/office/chat.json");` to the "keeps the office's files" test and the import.

In `chat-store.test.ts` (modelled on `board-store.test.ts`: the same `directory`, `logs`, `store()` helpers):

```text
test("a missing file is an empty chat", async () => expect(await store().load()).toEqual(emptyChat()));
test("what is saved loads back, with no temp file left, and the file is private", async () => {
  await store().save(data(1)); expect(await store().load()).toEqual(data(1));
  expect(await readdir(join(directory, "office"))).toEqual(["chat.json"]);
  expect((await stat(join(directory, "office", "chat.json"))).mode & 0o777).toBe(0o600);
});
test("a file that is not JSON is moved aside and the chat starts empty", async () => {
  await mkdir(join(directory, "office")); await writeFile(join(directory, "office", "chat.json"), "{nope");
  expect(await store().load()).toEqual(emptyChat());
  expect(await readdir(join(directory, "office"))).toEqual(["chat.json.corrupt-1700000000000"]);
  expect(logs.join("\n")).toContain("moved to");
});
test("a file of another shape is moved aside too", ...);     // {"v":2}
test("a photo in the file does not come back: its picture is dropped, the message stays", async () => {
  // a kind "photo" message with a data URL in `photo`: load returns it without `photo`
});
test("a load after a save reads what the save wrote", ...);   // two saves started together, then a load
test("a save that fails rejects and the next one still works", ...);  // the folder is a file
```

In `office-state.test.ts`:

```text
test("a chat event leaves the floor's state as it was", () => {
  expect(applyOfficeEvent(EMPTY_OFFICE, { type: "chat", change: { op: "typing", names: ["A"] } })).toBe(EMPTY_OFFICE);
});
test("the chat's changes", () => {
  let chat = applyChatEvent(null, { type: "snapshot", state: { ...EMPTY_OFFICE, chat: { messages: [m("a")], typing: [] } } });
  chat = applyChatEvent(chat, { type: "chat", change: { op: "add", message: m("b") } });
  expect(chat?.messages.map((x) => x.id)).toEqual(["a", "b"]);
  // the same id again is not added twice
  // update replaces by id, and appends one it does not know
  // typing sets the names; all replaces the messages and keeps the names
  // an add before any snapshot starts the chat from EMPTY_CHAT
  // 301 adds keep the newest 300
  // a snapshot without chat gives null; an act changes nothing
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd plugins && npx vitest run office/shared/contracts.test.ts --bail=1`, then the other three files one at a time.
Expected: FAIL, `ChatRequestSchema` and the rest are not exported.

- [ ] **Step 3: Write the contracts, the path, the store and the reducer**

`contracts.ts`: the block in Interfaces, with a one-line comment on each schema in the file's style. `chatRpc` goes after `incidentsDismissRpc`.

`paths.ts`:

```text
/** The team chat's conversation, kept as upstream's engine writes it. */
export function chatFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "chat.json");
}
```

`chat-store.ts` follows `board-store.ts`: `isMissing`, `moveAside(reason)` to `${file}.corrupt-${now()}` with the same two log lines, `write` through `${file}.tmp-${n}` then `rename`, `read` that moves aside on unreadable, non-JSON and `ChatFileSchema.safeParse` failure, and one `enqueue` chain for loads and saves. The write uses `writeFile(tempFile, text, { encoding: "utf8", mode: 0o600 })` as `incidents-store.ts` does. `ChatFileSchema` is `z.object({ v: z.literal(1), msgs: z.array(ChatMessageSchema), pinned: z.string().nullable(), days: z.record(z.string(), z.string()), keys: z.array(z.string()) })`. zod drops keys it does not know, which is what removes a photo's picture and a work card's body on load.

`office-state.ts`:

```text
export const EMPTY_CHAT: ChatSnapshot = { messages: [], typing: [] };

/** The chat as `useOffice` keeps it: apart from the floor, so a reaction does not rebuild the floor's model. */
export function applyChatEvent(chat: ChatSnapshot | null, event: OfficeEvent): ChatSnapshot | null {
  if (event.type === "snapshot") return event.state.chat ?? null;
  if (event.type !== "chat") return chat;
  const base = chat ?? EMPTY_CHAT;
  const { change } = event;
  switch (change.op) {
    case "add": {
      if (base.messages.some((m) => m.id === change.message.id)) return base;
      return { ...base, messages: [...base.messages, change.message].slice(-CHAT_MESSAGE_MAX) };
    }
    case "update": {
      const known = base.messages.some((m) => m.id === change.message.id);
      const messages = known ? base.messages.map((m) => (m.id === change.message.id ? change.message : m)) : [...base.messages, change.message];
      return { ...base, messages: messages.slice(-CHAT_MESSAGE_MAX) };
    }
    case "typing": return { ...base, typing: change.names };
    case "all": return { ...base, messages: change.messages };
    case "act": return base;
  }
}
```

and in `applyOfficeEvent` add `case "chat": return state;` (the exhaustive switch needs it). A snapshot's `chat` stays on `state` where it is parsed; nothing reads it there.

- [ ] **Step 4: Run them to see them pass**

Run each of the four files with `--bail=1`. Expected: PASS. Then typecheck, lint and format the changed files.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/shared/contracts.ts plugins/office/shared/contracts.test.ts plugins/office/server/chat-store.ts plugins/office/server/chat-store.test.ts plugins/office/server/paths.ts plugins/office/server/paths.test.ts plugins/office/client/office-state.ts plugins/office/client/office-state.test.ts
git commit -m "feat(office): the chat's contracts, its file and its client state"
```

---

### Task 3: The chat service

Needs Tasks 1 and 2. Can run in parallel with Task 5.

**Files:**

- Create: `plugins/office/server/chat-service.ts`
- Test: `plugins/office/server/chat-service.test.ts`

**Interfaces:**

- Consumes: Task 1's `createChatEngine`, `Translate`, `EngineMessage`, `ChatMember`; Task 2's `ChatStore`, `ChatData`, `emptyChat`, `ChatMessageSchema`, `ChatChange`, `ChatRequest`, `ChatResult`, `ChatSnapshot`, `CHAT_TEXT_MAX`, `CHAT_MESSAGE_MAX`; `DirectoryView` from `hub.ts`; `agentTitle` from `shared/model.ts`; `Clock` from `timers.ts`; `errorMessage` from `errors.ts`; `PluginTurnOutcome` from `@getpaseo/plugin/server`.
- Produces:

```text
export const CHAT_CLOCK_MS = 30_000;
export const RECALL_WINDOW_MS = 2 * 60 * 1000;
export const ANSWER_MAX = 1200;
export const PROMPT_PREFIX = "Team chat message from you: ";
export function staffNameOf(key: string, tr: Translate): string | null;
export function isUsageLimit(message: string): boolean;
export function lastAssistantText(items: readonly { type: string; text?: unknown }[]): string | null;
export function clipAnswer(text: string): string;
export function mentionedIds(text: string, members: readonly { id: string; name: string }[]): string[];
export interface ChatServicePorts {
  store: ChatStore; clock: Clock; tr: Translate;
  /** Sends a prompt that steers a running turn. */
  send(agentId: string, prompt: string): Promise<void>;
  /** The last assistant message of the turn `turnId`, read from the agent's timeline; null when there is none. */
  lastAnswer(agentId: string, turnId: string | null): Promise<string | null>;
  emit(change: ChatChange): void;
  log(message: string): void;
}
export interface ChatService {
  snapshot(): ChatSnapshot;
  /** The directory's view; null when it stops. The first view after null is a baseline and makes no lines. */
  view(view: DirectoryView | null): void;
  turnEnded(agent: { id: string }, outcome: PluginTurnOutcome, turnId: string | null): Promise<void>;
  archived(agentId: string): void;
  request(input: ChatRequest): Promise<ChatResult>;
  /** Cancels the clock and the engine's timers and waits for the last save. */
  stop(): Promise<void>;
}
export function createChatService(ports: ChatServicePorts): Promise<ChatService>;
```

- [ ] **Step 1: Write the pure-function tests first**

```text
test("only the director has a name", () => {
  expect(staffNameOf("__director", t)).toBe("Director");
  for (const key of ["__reception", "__hr", "__cleaner", "__guard", "__courier", "__accountant", "__claude"]) expect(staffNameOf(key, t)).toBeNull();
});
test("a usage limit is told from other errors", () => {
  expect(isUsageLimit("You've hit your usage limit. Resets at 5pm")).toBe(true);
  expect(isUsageLimit("429 rate limit exceeded")).toBe(true);
  expect(isUsageLimit("connection reset")).toBe(false);
});
test("the last assistant message is its consecutive parts joined, and none gives null", () => {
  expect(lastAssistantText([{ type: "assistant_message", text: "old" }, { type: "tool_call" }, { type: "assistant_message", text: "All " }, { type: "assistant_message", text: "done." }])).toBe("All done.");
  expect(lastAssistantText([{ type: "tool_call" }])).toBeNull();
  expect(lastAssistantText([{ type: "assistant_message", text: "  " }])).toBeNull();
});
test("an answer over 1,200 characters is clipped with an ellipsis", () => {
  expect(clipAnswer("x".repeat(1200))).toHaveLength(1200);
  const clipped = clipAnswer("x".repeat(2000));
  expect(clipped).toHaveLength(1200); expect(clipped.endsWith("…")).toBe(true);
});
test("an @name prompts its member only: a longer member's name and a name character after it do not count", () => {
  const team = [{ id: "m", name: "Mjd" }, { id: "m1", name: "Mjd-1" }, { id: "a", name: "Alice" }];
  expect(mentionedIds("@Mjd-1 go", team)).toEqual(["m1"]);
  expect(mentionedIds("@Mjd and @Mjd-1", team)).toEqual(["m", "m1"]);
  expect(mentionedIds("@Alice, hi", team)).toEqual(["a"]);
  expect(mentionedIds("@Alicex hi", team)).toEqual([]);
  expect(mentionedIds("@Bea hi", team)).toEqual([]);
  expect(mentionedIds("@Alice @Alice", team)).toEqual(["a"]);
});
```

- [ ] **Step 2: Write the harness and the service tests**

`Math.random` is pinned to 0.99 (`vi.spyOn(Math, "random").mockReturnValue(0.99)`, restored after each test): the engine's banter is then as quiet as it gets (no automatic reactions, no chance answers), and its delays are the top of each range. Times are local, as the engine reads them (`new Date(ctx.now())`).

```text
const MORNING = new Date(2026, 10, 18, 9, 0).getTime();        // a Wednesday
const WORKSPACE = { id: "w1", name: "main", projectName: "shop" };
const agent = (id, title, overrides = {}): OfficeAgent => ({ id, title, provider: "claude", model: null, status: "idle", workspaceId: "w1", parentAgentId: null, permissions: [], createdAt: "2026-11-18T05:00:00.000Z", ...overrides });
const view = (...agents: OfficeAgent[]): DirectoryView => ({ agents, workspaces: [WORKSPACE] });

async function harness(options: { at?: number; store?: ChatStore } = {}) {
  const clock = createFakeClock(options.at ?? MORNING);
  const sent: [string, string][] = [], asked: string[] = [], changes: ChatChange[] = [], saved: ChatData[] = [], logs: string[] = [];
  const answers = new Map<string, string | null>();
  const failure = { send: null as Error | null, answer: null as Error | null };
  const store: ChatStore = options.store ?? { load: async () => emptyChat(), save: async (data) => { saved.push(structuredClone(data)); } };
  const service = await createChatService({
    store, clock, tr: t,
    send: async (id, prompt) => { if (failure.send) throw failure.send; sent.push([id, prompt]); },
    lastAnswer: async (id) => { asked.push(id); if (failure.answer) throw failure.answer; return answers.get(id) ?? null; },
    emit: (change) => changes.push(change), log: (m) => logs.push(m),
  });
  return { service, clock, sent, asked, changes, saved, logs, answers, failure };
}
const said = (h, name) => h.service.snapshot().messages.filter((m) => m.name === name).map((m) => m.text);
const WORK = (key: string) => t(`chat.work.${key}`, null, "list");
```

Tests (each is a `test(...)` with the harness; `h.clock.advance(10_000)` lets the engine's delayed lines through):

```text
test("a new conversation starts with upstream's first line and says so to nobody", ...);   // snapshot().messages is [sys "created"]; changes is [] (the constructor's emit is not sent)
test("an @mention is answered with what the agent is on, from the team of the last view", ...);
  // view(Alice idle, Bea running); send "@Alice what are you on?"; advance; last message from "a1" with name "Alice", text in t("chat.reply.statusRest", null, "list"), reply.name "Boss"; Bea says nothing
test("one message to two agents is two prompts that steer, and both show typing", ...);
  // send "@Alice @Bea look at the build": sent equals [["a1", PROMPT], ["a2", PROMPT]] with PROMPT = `${PROMPT_PREFIX}@Alice @Bea look at the build`; typing ["Alice","Bea"]
test("a prompt names a member that is a prefix of a longer one once", ...);
  // members "Mjd" and "Mjd-1": send "@Mjd-1 go" -> one prompt to the sub-agent
test("an archived agent matches nobody: no prompt, no answer", ...);
  // archived("a1") says "Alice left the group" (t("chat.sys.left", {name:"Alice"})); then send "@Alice hi" sends nothing
test("when the turn ends the agent's last message is posted as a reply to your message and typing stops", ...);
  // answers.set("a1","All green."); send "@Alice run the tests"; turnEnded({id:"a1"},{kind:"completed"},"t1");
  // a message from a1 with text "All green." whose reply is { id: <my id>, name: "Boss", text: "@Alice run the tests" }; typing []
test("an answer is clipped and keeps its whole length up to 1,200", ...);
test("a turn that ends in an error posts no answer: fail speaks, the answer is not read, typing stops", ...);
  // turnEnded(..., { kind: "failed", error: { message: "boom" } }, "t1"); asked is []; a1's lines are in WORK("fail"); typing []
test("a usage limit speaks its own line", ...);   // WORK("limit")
test("a cancelled turn posts nothing and stops the typing", ...);
test("an answer that cannot be read posts nothing, logs, and the agent stops typing", ...);   // failure.answer = new Error("x")
test("a prompt that cannot be sent says so and stops the typing", ...);
  // failure.send = new Error("agent is gone"); settle(); last sys line "Could not reach Alice: agent is gone."; typing []
test("a turn that ends with no office open still gets its answer", ...);
  // view(Alice); send; view(null); turnEnded -> the answer is posted
test("two messages to one agent in one turn get one answer, replying to the newest", ...);
test("each office event is the engine's line", ...);   // one small test per row, below
  // baseline view(Alice): no new messages even after advance
  // new agent Bea: sys t("chat.sys.added", { by: "Boss", name: "Bea" }) and a line in the hello set
  // a permission with kind "tool" on Alice: said(h,"Alice") has a line in WORK("wait"); kind "question": WORK("ask")
  // a new agent with parentAgentId a1: Alice says a line in WORK("helper"); the sub-agent itself says nothing
  // turnEnded completed: a line from Alice that is one of WORK("done") with its {task} filled (the agent's title)
  // an agent already in the baseline is not announced; a permission already in it is not either
test("the director is the only staff, so the morning hello does not come and the lunch poll comes from an agent", ...);
  // at 8:00 with Alice in the view: advance(CHAT_CLOCK_MS) leaves only the "created" line.
  // at 10:50: advance(CHAT_CLOCK_MS): a message of kind "poll" from "a1", and the sys line t("chat.sys.poll", ...)
test("a vote, an rsvp and a reaction reach the engine as you, and the same reaction again takes it back", ...);
test("a message can be recalled for two minutes, and later the server refuses", ...);
  // advance(RECALL_WINDOW_MS + 1): { ok: false, error: "A message can be recalled for two minutes." }
test("a word for a meeting is an act for the open scenes, and a word for tea is none", ...);
  // send "meeting at 10": changes include one { op: "act", what: "meeting", id: expect.any(String) }; "milk tea" adds none
test("a send with nothing in it or a sticker that is not on the list is refused", ...);
test("the conversation is kept across a restart, and the clock keeps its 30 s beat", ...);
  // a real createChatStore over a temp folder: send, stop(); a second service reads the same messages
test("a save that fails is logged and the next change saves again", ...);
test("saves in flight collapse to the newest one", ...);
  // a store whose save waits on a gate: three reactions while it waits are one more save, with all three
test("the engine's timers drain: after the banter only the 30 s clock is waiting, and stop() leaves none", ...);
  // send "@Alice hi" and "meeting"; advance(120_000); expect(clock.pending()).toBe(1); await service.stop(); expect(clock.pending()).toBe(0)
test("lines are told to subscribers as changes, and not while the engine is being made", ...);
```

Write each body in full with the helpers above; the comments say what is asserted.

- [ ] **Step 3: Run them to see them fail**

Run: `cd plugins && npx vitest run office/server/chat-service.test.ts --bail=1`
Expected: FAIL, `./chat-service.js` does not exist.

- [ ] **Step 4: Write the service**

```text
import { createChatEngine, type ChatMember, type ChatEngine, type EngineMessage, type Translate } from "../vendor/my-office/src/shared/chat-engine.js";
import type { PluginTurnOutcome } from "@getpaseo/plugin/server";
import { CHAT_MESSAGE_MAX, CHAT_TEXT_MAX, ChatMessageSchema, type ChatChange, type ChatMessage, type ChatRequest, type ChatResult, type ChatSnapshot } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import type { ChatData, ChatStore } from "./chat-store.js";
import { errorMessage } from "./errors.js";
import type { DirectoryView } from "./hub.js";
import type { Clock } from "./timers.js";

// (constants, staffNameOf, isUsageLimit, lastAssistantText, clipAnswer, mentionedIds as in Interfaces)

const DIRECTOR = "__director";
const USAGE_LIMIT = /usage limit|rate limit|quota|limit (?:reached|exceeded|resets)|out of (?:usage|credits)/i;
// Copied from packages/protocol/src/agent-attention-notification.ts findLatestAssistantMessageFromTimeline:
// a plugin cannot import the protocol package.
export function lastAssistantText(items) {
  const chunks: string[] = [];
  for (const item of items.toReversed()) {
    if (item.type === "assistant_message" && typeof item.text === "string") { chunks.push(item.text); continue; }
    if (chunks.length > 0) break;
  }
  const text = chunks.toReversed().join("").trim();
  return text === "" ? null : text;
}
export const clipAnswer = (text: string) => text.length > ANSWER_MAX ? `${text.slice(0, ANSWER_MAX - 1).trimEnd()}…` : text;
const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);   // the engine's own `short`
const NAME_CHAR = /[\p{L}\p{N}_-]/u;
export function mentionedIds(text, members) {
  const claimed: [number, number][] = [];
  const found = new Map<string, number>();
  for (const member of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${member.name}`;
    for (let from = text.indexOf(needle); from !== -1; from = text.indexOf(needle, from + 1)) {
      const end = from + needle.length;
      if (end < text.length && NAME_CHAR.test(text.charAt(end))) continue;
      if (claimed.some(([start, stop]) => from < stop && end > start)) continue;
      claimed.push([from, end]);
      if (!found.has(member.id)) found.set(member.id, from);
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

function memberOf(agent: OfficeAgent, workspaces: readonly OfficeWorkspace[]): ChatMember {
  return {
    id: agent.id,
    name: agentTitle(agent),
    status: agent.status === "idle" ? "rest" : "work",
    task: agent.title?.trim() ?? "",
    project: workspaces.find((w) => w.id === agent.workspaceId)?.projectName ?? "",
  };
}

const wireOf = (message: EngineMessage): ChatMessage | null => {
  const parsed = ChatMessageSchema.safeParse(message);   // drops a photo's picture and the cards' bodies
  return parsed.success ? parsed.data : null;
};

interface Waiting { member: ChatMember; reply: { id: string; name: string; text: string } }
const OK: ChatResult = { ok: true };

export async function createChatService(ports: ChatServicePorts): Promise<ChatService> {
  const { clock, log, tr } = ports;
  const loaded = await ports.store.load();
  const roster = new Map<string, ChatMember>();
  const waiting = new Map<string, Waiting>();
  const timers = new Set<() => void>();
  // The permission ids each agent had in the last view; null until the first view of an open office.
  let baseline: Map<string, Set<string>> | null = null;
  // False while the engine is being made: it saves and emits from its constructor, before `engine` exists.
  let live = false;
  let stopped = false;
  let capture: EngineMessage[] | null = null;
  let acts = 0;
  let cancelClock: (() => void) | null = null;

  // One write at a time; while it runs only the newest conversation waits.
  let dirty: ChatData | null = null;
  let saving: Promise<void> | null = null;
  async function drain(): Promise<void> {
    try {
      while (dirty !== null) {
        const next = dirty; dirty = null;
        try { await ports.store.save(next); } catch (error) { log(`[office] chat save failed: ${errorMessage(error)}`); }
      }
    } finally { saving = null; }
  }
  function queueSave(data: unknown): void {
    dirty = structuredClone(data) as ChatData;
    saving ??= drain();
  }
  ...
```

`structuredClone(data) as ChatData`: the engine hands `save` its own plain object, so a typed guard is not worth a function; if lint rejects the cast, parse with `ChatFileSchema.parse(structuredClone(data))` instead (the engine's payload is valid by construction) and keep the name.

The rest, in this order:

```text
  const members = (): ChatMember[] => [...roster.values(), ...[...waiting.values()].map((w) => w.member).filter((m) => !roster.has(m.id))];

  function emit(op: "add" | "update" | "typing" | "all", payload?: EngineMessage | string[]): void {
    if (!live) return;
    if (Array.isArray(payload)) { ports.emit({ op: "typing", names: payload }); return; }
    if (payload !== undefined) {
      capture?.push(payload);
      const message = wireOf(payload);
      if (message !== null) ports.emit({ op: op === "update" ? "update" : "add", message });
      return;
    }
    ports.emit({ op: "all", messages: wireMessages() });
  }
  const engine: ChatEngine = createChatEngine({
    tr, now: () => clock.now(), members, staffName: (key) => staffNameOf(key, tr),
    store: { load: () => loaded, save: queueSave },
    emit,
    act: (what) => { if (what === "meeting") ports.emit({ op: "act", what: "meeting", id: `a${(acts += 1)}` }); },
    // The engine calls the global clearTimeout on what this returns, which is a no-op for a cancel function:
    // a stale tick still fires and finds nothing due. They stop when the queue is empty.
    timer: (run, ms) => { const cancel = clock.setTimeout(() => { timers.delete(cancel); run(); }, ms); timers.add(cancel); return cancel; },
  });
  live = true;

  const wireMessages = () => engine.state.msgs.slice(-CHAT_MESSAGE_MAX).flatMap((m) => wireOf(m) ?? []);
  function scheduleClock(): void { ... every CHAT_CLOCK_MS: try engine.clock() catch log; then again unless stopped }
  scheduleClock();
  // view, send, turnEnded, archived, request, stop as described in the notes below
```

`wireMessages` is a function declaration (hoisted), so `emit` may call it; write it as `function wireMessages()` to keep that true.

- `view(next)`: `null` sets `baseline = null` and keeps the roster. Otherwise: the open agents are those whose `status !== "closed"`; the roster is rebuilt from them with `memberOf`; the new baseline is `Map(id -> Set(permission ids))`; with a previous baseline, a new agent is `engine.onEvent(agent.parentAgentId === null ? { type: "start", sess: agent.id } : { type: "substart", sess: agent.parentAgentId, agent: true })` and each permission id not in its previous set (an empty set for a new agent) is `{ type: permission.kind === "question" ? "ask" : "wait", sess: agent.id }`. The roster is set before any event is told, because the engine looks the agent up.
- `send` (private): trims and slices the text to `CHAT_TEXT_MAX`; refuses empty text with no sticker (`{ ok: false, error: "There is nothing to send." }`) and a sticker index outside `tr("chat.stickers", null, "list")`; takes the targets with `mentionedIds(text, members())` before the engine runs; runs `engine.send({ text, sticker, replyTo })` with `capture` set to a fresh array; takes your message as the captured one with `from === "me"`; for each target builds the quote `{ id: mine.id, name: tr("chat.boss"), text: short(text, 90) }` and calls `prompt(member, text, quote)`. The sends are not awaited: a failure is a system line, not an RPC error.
- `prompt(member, text, reply)`: `waiting.set(member.id, { member, reply })`, `engine.working(member.id, true)`, then `ports.send(member.id, PROMPT_PREFIX + text).catch(...)`. The catch, only when `waiting.get(member.id)?.reply === reply`, calls `engine.working(member.id, false)` and deletes the entry, then always `engine.system("Could not reach <name>: <error>.")`.
- `turnEnded(agent, outcome, turnId)`: tell the engine `stop` (completed) or `fail` with `limit: isUsageLimit(outcome.error.message)` (failed); a cancelled turn tells nothing. If this agent has a waiting prompt: for a completed turn read `ports.lastAnswer` and `engine.say(agent.id, clipAnswer(text), { now: true, long: true, reply })` when it returned text; catch and log a read that failed; in `finally`, if the entry is still the same one, `engine.working(agent.id, false)` and then delete it (typing is cleared while the agent is still a member through `waiting`).
- `archived(id)`: if waiting, `engine.working(id, false)` then delete; `const member = roster.get(id) ?? waitingMember`; delete from the roster; `engine.onLeft(member.name)` when there is one.
- `request`: `send` for `send`; `engine.react/vote/rsvp(input.id, "me", ...)` for the three; for `recall` refuse with `{ ok: false, error: "A message can be recalled for two minutes." }` when the message exists, is yours and `clock.now() - message.at > RECALL_WINDOW_MS`, else `engine.recall(input.id)`. Each returns `OK`.
- `snapshot()`: `{ messages: wireMessages(), typing: [...engine.state.typing] }`.
- `stop()`: `stopped = true; live = false;` cancel the clock and every timer in `timers`; `await saving`.

- [ ] **Step 5: Run them to see them pass**

Run: `cd plugins && npx vitest run office/server/chat-service.test.ts --bail=1`
Expected: PASS. Fix by reading the failure, not by loosening a test. Then typecheck, lint and format `chat-service.ts` and its test.

- [ ] **Step 6: Commit**

```bash
git add plugins/office/server/chat-service.ts plugins/office/server/chat-service.test.ts
git commit -m "feat(office): the chat service runs upstream's engine with the office's team"
```

---

### Task 4: Wire it into the hub and the entry

Needs Tasks 2 and 3.

**Files:**

- Modify: `plugins/office/server/hub.ts` (`setChat`, `chatChange`, `watch`; `chat` in `snapshot()`)
- Modify: `plugins/office/server/live-ports.ts` (`liveChatPorts`)
- Modify: `plugins/office/index.server.ts` (deps, the service, the call, two hooks)
- Test: `plugins/office/server/hub.test.ts`, `plugins/office/server/live-ports.test.ts`, `plugins/office/index.server.test.ts`

**Interfaces:**

- Consumes: Task 3's `createChatService`, `ChatService`; Task 2's `ChatStore`, `chatFile`, `chatRpc`, `ChatSnapshot`, `ChatChange`; the vendored `t` from `vendor/my-office/src/i18n/index.js`.
- Produces in `hub.ts`:

```text
// on Hub
/** The conversation each snapshot carries from now on; null removes it. Every subscriber gets a fresh snapshot. */
setChat(source: (() => ChatSnapshot) | null): void;
/** One change of the conversation, sent as a `chat` event to subscribers that have their snapshot. */
chatChange(change: ChatChange): void;
/** Calls `listener` with each view the directory reports, and with null when it stops; at once with the current view when a directory is open. Returns what ends it. */
watch(listener: (view: DirectoryView | null) => void): () => void;
```

- Produces in `live-ports.ts`: `liveChatPorts(holder: PaseoHolder): Pick<ChatServicePorts, "send" | "lastAnswer">`. `send` is `holder.require().agents.ref(agentId).send(prompt, { activeTurnBehavior: "steer" })`. `lastAnswer` is `refetch({ direction: "tail", limit: 1, wholeTurns: true })`, keeps the entries whose `turnId` equals the hook's turn id (none when it is null, as the hook's documentation says) and returns `lastAssistantText(entries.map((entry) => entry.item))`.
- Produces in `index.server.ts`: `OfficePluginDeps.chatStore: ChatStore`, the handler for `chatRpc`, `office.chat.request` registered after `office.incidents.dismiss.request`.

- [ ] **Step 1: Write the failing tests**

`hub.test.ts` (with its `fakePorts` and a subscriber helper, as the incidents tests use them):

```text
test("a chat source is in the next snapshot and subscribers get one when it is set", ...);
  // open a subscriber; setChat(() => ({ messages: [], typing: ["A"] })); the subscriber's last event is a snapshot with chat typing ["A"]; a new subscriber's first snapshot has it too; setChat(null) removes it
test("a chat change goes to subscribers that have their snapshot, as a chat event", ...);
test("a watcher gets each view the directory reports, and null when it stops", ...);
  // watch before the first subscriber: nothing; attach: the first view; emit a view: the view; the subscriber leaves: null
test("a watcher added while a directory is open gets the current view at once, and can be removed", ...);
test("a watcher that throws is logged and does not stop the others", ...);
```

`live-ports.test.ts`:

```text
test("a chat prompt steers a running turn", async () => {
  await ports.send("run", "Team chat message from you: hi");
  expect(sent).toEqual([{ agentId: "run", text: "Team chat message from you: hi", options: { activeTurnBehavior: "steer" } }]);
});
test("the answer is the last assistant message of the turn the hook names", async () => {
  // a fake timeline.refetch recording its options and returning entries { turnId: "t1", item: { type: "assistant_message", text: "Done." } } and one of turn "t0"
  expect(options).toEqual({ direction: "tail", limit: 1, wholeTurns: true });
  expect(await ports.lastAnswer("a", "t1")).toBe("Done.");
  expect(await ports.lastAnswer("a", null)).toBeNull();
  expect(await ports.lastAnswer("a", "t9")).toBeNull();
});
```

`index.server.test.ts`: add a `memoryChatStore()` beside `memoryIncidentsStore()`, pass `chatStore` in `setup`, and change the two existing expectations that count the office's own entries: the handler list gains `"office.chat.request"` at the end, and the pending timers after `setup` are 2 (the hourly prune and the chat's 30 s clock), 0 after `stop()`. New tests:

```text
test("a chat send posts your message to an open office and the snapshot carries the chat", async () => {
  // subscribe to office.state with a recording push (see the notes and incidents tests of this file),
  // call office.chat.request { op: "send", text: "hello" }: { ok: true };
  // the subscriber got a chat event { op: "add", message: { from: "me", text: "hello" } }; a later subscriber's snapshot has chat.messages with it
});
test("a chat call with a bad op is refused by the contract", ...);   // parse through chatRpc.input
test("a turn that ends, and an archive, reach the chat", async () => {
  // no members here (the fake directory is empty), so assert the hooks do not throw and log nothing: hooks "agent.turn.after" and "agent.archive.after" with the existing hookAgent("a1")
});
test("a chat that cannot start answers its call with an error and the rest of the office goes on", ...);
  // a chatStore whose load rejects: office.chat.request rejects "The team chat did not start"; office.post.request still works; logs has "[office] chat unavailable"
test("the chat's clock beats every 30 s until the office stops", ...);   // advance 30_000: still one clock timer pending besides the prune
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd plugins && npx vitest run office/server/hub.test.ts --bail=1`, then `office/server/live-ports.test.ts`, then `office/index.server.test.ts`.
Expected: FAIL.

- [ ] **Step 3: Write the hub methods**

In `hub.ts`: `let chatSource: (() => ChatSnapshot) | null = null;` and `const watchers = new Set<(view: DirectoryView | null) => void>();` beside the other state. `snapshot()` adds `...(chatSource === null ? {} : { chat: chatSource() })`. `setChat(source)` sets it and `broadcast({ type: "snapshot", state: snapshot() })`, as `setNotes` does. `chatChange(change)` is `broadcast({ type: "chat", change })`. A helper `tell(view)` calls each watcher in a `try`, logging `[office] chat watcher failed: ...`. `onDirectory` calls `tell(view)` after it assigns `view`; `idle()` calls `tell(null)` after it resets the state. `watch(listener)` adds the listener, calls `listener(view)` at once when `stopDirectory !== null`, and returns `() => watchers.delete(listener)`.

`read()` returns `snapshot()` with the chat in it for a stand-up read; that is harmless, and the notes writer ignores it.

- [ ] **Step 4: Write `liveChatPorts`, then the entry**

`live-ports.ts`: the two functions above. Import `lastAssistantText` from `./chat-service.js`.

`index.server.ts`:

```text
// in OfficePluginDeps
/** Where the team chat keeps its conversation. */
chatStore: ChatStore;

// after the incidents block, before `settings`' followers or beside them
// One service for the office's life, made as the server starts. Its file is read first; until then
// the chat call waits, and a snapshot has no chat.
let chat: ChatService | null = null;
let stopWatching: (() => void) | null = null;
const chatReady = createChatService({
  store: deps.chatStore,
  clock: deps.clock,
  tr: t,
  ...liveChatPorts(holder),
  emit: (change) => hub.chatChange(change),
  log,
})
  .then((service) => {
    chat = service;
    stopWatching = hub.watch((view) => service.view(view));
    hub.setChat(() => service.snapshot());
  })
  .catch((error: unknown) => log(`[office] chat unavailable: ${errorMessage(error)}`));

// with the other handlers, after incidentsDismissRpc
server.handle(chatRpc, (input, context) => {
  holder.remember(context.paseo);
  return guarded("chat", async () => {
    await chatReady;
    if (chat === null) throw new Error("The team chat did not start");
    return chat.request(input);
  });
});
```

In `agent.turn.after`, inside its first `try`, after `office.turnEnded(agent.id)`: `void chat?.turnEnded(agent, outcome, turnId).catch(...)`, with the destructure now `{ agent, outcome, turnId }`; in `agent.archive.after`, after `office.agentGone(agent.id)`: `chat?.archived(agent.id)`. In the returned stop function: `stopWatching?.()` and `await chat?.stop()` before `await hub.stop()`. Import `t` from `./vendor/my-office/src/i18n/index.js`, `createChatStore` and `chatFile` in `contribute` (`chatStore: createChatStore({ file: chatFile(process.env, homedir()), now: () => Date.now(), log })`).

Note: `chat` and `stopWatching` are `let` read by hooks and the handler after `chatReady`; the plugin's lint rule against closure `let` mutation, if it flags them, is answered by holding them in one `const chatHolder: { service: ChatService | null; stop: (() => void) | null }`.

- [ ] **Step 5: Run them to see them pass**

Run the three files with `--bail=1`. Expected: PASS.
Run: `npx vitest run packages/server/src/server/plugins/builtin/index.test.ts --bail=1` from the repo root.
Expected: PASS. This test compiles every built-in plugin with the daemon's own compiler, so it is the check that the vendored engine, the locale and the `.d.ts` files bundle for the server (Review Focus 7). Then typecheck, lint and format the changed files.

- [ ] **Step 6: Commit**

```bash
git add plugins/office/server/hub.ts plugins/office/server/hub.test.ts plugins/office/server/live-ports.ts plugins/office/server/live-ports.test.ts plugins/office/index.server.ts plugins/office/index.server.test.ts
git commit -m "feat(office): the office's server keeps the team chat and sends it in office.state"
```

---

### Task 5: The chat's client text, its seen mark, and the gather call

Needs Tasks 1 and 2. Can run in parallel with Tasks 3 and 4.

**Files:**

- Create: `plugins/office/client/chat-text.ts`, `plugins/office/client/chat-seen.ts`, `plugins/office/client/chat-acts.ts`
- Modify: `plugins/office/client/use-office.ts` (the chat apart from the floor, and acts)
- Modify: `plugins/office/client/world/world-api.ts` (`gather?()`), `plugins/office/client/world/world-view.tsx` (call it), `plugins/office/vendor/my-office/src/office/paseo-entry.js` (`gather()`)
- Test: `plugins/office/client/chat-text.test.ts`, `plugins/office/client/chat-seen.test.ts`, `plugins/office/client/chat-acts.test.ts`, `plugins/office/client/world/entry.test.ts`

**Interfaces:**

- Consumes: `ChatMessage`, `ChatSnapshot`, `ChatChange` from `contracts.ts`; `REACTIONS` from the vendored engine; `chat.stickers` from the vendored locale; `matchesQuery` from `list-text.ts`; `agentTitle`, `OfficeModel` from `shared/model.ts`; `lookOf`, `SHIRTS` from `client/pixel/art.ts`; Task 2's `applyChatEvent`.
- Produces in `chat-text.ts`:

```text
export const CHAT_EMPTY = "No messages yet. @ an agent to give it work.";
export const CHAT_RECALLED = "Message recalled";
export const COUNTER_FROM = 500;
export const SHOW_MORE_LINES = 8;
export const STICKERS: readonly string[];            // upstream's eight, English
export const REACTION_CHOICES: readonly string[];    // upstream's six
export const DIRECTOR_COLOR = "#2B3A55";             // upstream's director (people/director.js)
export function shows(message: ChatMessage): boolean;            // text, sticker, poll, remind, sys only
export function isYours(message: ChatMessage): boolean;          // from === "me"
export function timeLabel(at: number, now: number): string;      // "09:05", "Yesterday 09:05", "12 Nov 09:05"
export function typingText(names: readonly string[]): string | null;
export function counterText(length: number): string | null;      // "512 / 600" from COUNTER_FROM, else null
export function unreadCount(messages: readonly ChatMessage[], seenAt: number): number;   // not yours, not system lines
export function unreadLabel(count: number): string | null;       // null at 0, "99+" over 99
export function canRecall(message: ChatMessage, now: number): boolean;   // yours, not recalled, within two minutes
export function isLong(text: string): boolean;                   // more than SHOW_MORE_LINES lines, or 8 x 60 characters
export function reactionRows(message: ChatMessage): { emoji: string; count: number; mine: boolean }[];
export function avatarOf(message: ChatMessage): { initials: string; color: string } | null;   // null for a system line and for you
export function pollRows(message: ChatMessage): { index: number; text: string; count: number; mine: boolean }[];
export function remindState(message: ChatMessage): { when: string; going: number; yours: "yes" | "no" | null; done: boolean } | null;
export interface Mention { start: number; query: string }
export function mentionAt(text: string): Mention | null;         // the last "@" that starts the text or follows a space, with no new line and at most 40 characters after it
export interface MentionOption { id: string; name: string; room: string }
export function mentionOptions(model: OfficeModel, query: string): MentionOption[];   // matchesQuery over each row, at most 8, in the floor's order
export function putMention(text: string, mention: Mention, name: string): string;     // replaces "@query" with "@Name "
export function enterSends(event: { key: string; shiftKey?: boolean }): boolean;      // Enter without Shift
```

- Produces in `chat-seen.ts`: `getChatSeen(): number`, `markChatSeen(at: number): void` (only moves forward), `subscribeChatSeen(listener: () => void): () => void`, `useChatSeen(): number`, `resetChatSeen(value: number | null): void` (tests only). Storage: `localStorage["office-chat-seen"]` as a number string when `localStorage` exists and works; memory for the app run otherwise (a phone's native app has none). With nothing stored, the mark starts at `Date.now()` on first read.
- Produces in `chat-acts.ts`: `onChatAct(listener: (what: "meeting") => void): () => void`, `emitChatAct(change: { what: "meeting"; id: string }): void` (an `id` already seen is dropped; the last 50 ids are kept).
- Produces in `use-office.ts`: `OfficeState.chat: ChatSnapshot | null`. The chat is kept in its own state: a `chat` event never calls `setState` for the floor, a snapshot's `chat` is removed from `state` and seeds `chat`, and an `act` change calls `emitChatAct`.
- Produces: `WorldApi.gather?(): void`; `gather()` on `PaseoOfficeWorld`.

- [ ] **Step 1: Write the failing tests**

`chat-text.test.ts`, with a `message(overrides)` builder:

```text
test("only five kinds show", () => {
  for (const kind of ["text", "sticker", "poll", "remind", "sys"]) expect(shows(message({ kind }))).toBe(true);
  for (const kind of ["photo", "work", "loop", "ci", "deny", "nonsense"]) expect(shows(message({ kind }))).toBe(false);
});
test("time labels: today, yesterday, older", () => {
  const now = new Date(2026, 10, 17, 14, 0).getTime();
  expect(timeLabel(new Date(2026, 10, 17, 9, 5).getTime(), now)).toBe("09:05");
  expect(timeLabel(new Date(2026, 10, 16, 23, 59).getTime(), now)).toBe("Yesterday 23:59");
  expect(timeLabel(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe("12 Nov 09:05");
});
test("typing words", () => {
  expect(typingText([])).toBeNull();
  expect(typingText(["Alice"])).toBe("Alice is typing…");
  expect(typingText(["Alice", "Bea"])).toBe("Alice and Bea are typing…");
  expect(typingText(["A", "B", "C"])).toBe("Several people are typing…");
});
test("the counter shows from 500 of 600", () => {
  expect(counterText(499)).toBeNull(); expect(counterText(500)).toBe("500 / 600"); expect(counterText(600)).toBe("600 / 600");
});
test("unread: messages after the mark that are not yours and not system lines", ...);
test("the unread label is none at zero and 99+ over 99", ...);
test("a message can be recalled for two minutes, only if yours and not recalled", ...);
test("a long answer is over eight lines or eight rows of characters", ...);
test("reaction rows keep upstream's order, count each, and mark yours", ...);
test("the director's avatar is upstream's colour and an agent's is its floor shirt by id", () => {
  expect(avatarOf(message({ from: "__director", name: "Director" }))).toEqual({ initials: "D", color: DIRECTOR_COLOR });
  expect(avatarOf(message({ from: "a1", name: "Mjd-1" }))?.color).toBe(SHIRTS[lookOf("a1").shirt].shirt);
  expect(avatarOf(message({ from: "a1", name: "Mjd-1" }))?.initials).toBe("MJ");   // two words: first letters; one word: first two
  expect(avatarOf(message({ from: "me" }))).toBeNull();
  expect(avatarOf(message({ kind: "sys", from: undefined }))).toBeNull();
});
test("poll rows count voters and mark your vote", ...);
test("a reminder says when it is, how many go, what you said, and whether it is over", ...);
test("@ at the end of the text opens the list, with the words after it", () => {
  expect(mentionAt("hi @")).toEqual({ start: 3, query: "" });
  expect(mentionAt("hi @fix lo")).toEqual({ start: 3, query: "fix lo" });
  expect(mentionAt("mail me@x")).toBeNull();      // an @ inside a word is not a mention
  expect(mentionAt("@a\nb")).toBeNull();
  expect(mentionAt("@" + "x".repeat(41))).toBeNull();
});
test("the list is the model's agents matched with the List's search, in the floor's order, eight at most", ...);
test("a chosen name replaces the typed words", () => expect(putMention("hi @fi", { start: 3, query: "fi" }, "Fix login")).toBe("hi @Fix login "));
test("Enter sends and Shift+Enter does not", ...);
```

`chat-seen.test.ts` (jsdom environment):

```text
test("with nothing stored the mark starts now", ...);              // resetChatSeen(null); vi.setSystemTime; getChatSeen() === now and localStorage has it
test("a mark moves forward only, is stored, and tells its listeners", ...);
test("a device without localStorage keeps the mark in memory", ...);   // vi.stubGlobal("localStorage", undefined)
test("a storage that throws does not break the mark", ...);
```

`chat-acts.test.ts`:

```text
test("an act reaches each listener once, and the same id again is dropped", ...);
test("a listener that left hears nothing", ...);
```

`use-office` is covered by a mounted check in Task 6 (it needs the subscription mock); here only its pure parts are tested.

`entry.test.ts`: add `gather(): void` to the `World` interface, let the `ringBell` mock count (`ringBell() { h.rung += 1; }`, `h.rung = 0` in `beforeEach`, `rung: 0` in `h`), and:

```text
test("gather rings the bell for everyone without telling Paseo, and meet is not changed", () => {
  const bell = vi.fn();
  host.bell = bell;
  world.gather();
  expect(h.rung).toBe(1);
  expect(bell).not.toHaveBeenCalled();
  world.meet();
  expect(h.rung).toBe(2);
});
```

(`world.meet` is added to the `World` interface in the same edit. If `host.bell` is reset by another test, set it inside this one as shown.)

- [ ] **Step 2: Run them to see them fail**

Run each file with `cd plugins && npx vitest run office/client/chat-text.test.ts --bail=1` and so on.
Expected: FAIL.

- [ ] **Step 3: Write the modules**

`chat-text.ts` imports `REACTIONS` from `../vendor/my-office/src/shared/chat-engine.js`, `chat from "../vendor/my-office/src/i18n/locales/en/chat.js"` for `STICKERS`, `SHIRTS` and `lookOf` from `./pixel/art.js`. Initials: split the name on spaces and dashes into words; with two or more words the first letters of the first two, else the first two characters; upper-case. Time labels use local time and `Intl`-free formatting (`String(h).padStart(2, "0")`), and the month as the three-letter English name from a fixed array. `mentionAt` scans for the last `@` with `text.lastIndexOf("@")`, accepts it when it is at 0 or follows whitespace and the rest has no `\n` and is at most 40 characters. `mentionOptions` walks `model.rooms` and each room's `rows`, keeps `matchesQuery(row, room, query)`, and returns `{ id: row.agent.id, name: agentTitle(row.agent), room: room.name }`.

`chat-seen.ts`:

```text
import { useSyncExternalStore } from "react";

const KEY = "office-chat-seen";
const listeners = new Set<() => void>();
let seen: number | null = null;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;   // a browser that refuses storage (private mode, a blocked frame)
  }
}
function remember(value: number): void {
  try { storage()?.setItem(KEY, String(value)); } catch { /* memory only */ }
}
export function getChatSeen(): number {
  if (seen !== null) return seen;
  let stored: number | null = null;
  try {
    const text = storage()?.getItem(KEY);
    const parsed = text === null || text === undefined ? NaN : Number(text);
    stored = Number.isFinite(parsed) ? parsed : null;
  } catch { /* none */ }
  seen = stored ?? Date.now();
  if (stored === null) remember(seen);
  return seen;
}
export function markChatSeen(at: number): void {
  if (at <= getChatSeen()) return;
  seen = at;
  remember(at);
  for (const listener of listeners) listener();
}
export function subscribeChatSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const useChatSeen = (): number => useSyncExternalStore(subscribeChatSeen, getChatSeen);
export function resetChatSeen(value: number | null): void { seen = value; }
```

`chat-acts.ts`: a `Set` of listeners and an array of the last 50 ids.

`use-office.ts`: add `const [chat, setChat] = useState<ChatSnapshot | null>(null)` and `const chatLatest = useRef<ChatSnapshot | null>(null)`. In `onEvent`: first, `if (event.type === "chat") { if (event.change.op === "act") emitChatAct(event.change); chatLatest.current = applyChatEvent(chatLatest.current, event); setChat(chatLatest.current); return; }`; for the other events the existing path runs, with a snapshot's chat taken out of the floor's state (`const { chat: snapshotChat, ...floor } = event.state` when `event.type === "snapshot"`, passing `{ type: "snapshot", state: floor }` on and setting `chatLatest.current = snapshotChat ?? null` then `setChat(...)`). Return `{ state, loaded, subscription, chat }`. `EMPTY_OFFICE` and the feed store are unchanged.

`world-api.ts`: after `meet?(): void;` add:

```text
  /**
   * A chat that calls a meeting: rings the same bell without telling Paseo (`onBell`), so the
   * stand-up notes writer does not start. Upstream's own opening line, not the stand-up's. Nothing
   * happens while another gathering is on, or when nobody is free.
   */
  gather?(): void;
```

`paseo-entry.js`, after `meet()`:

```text
  /**
   * A meeting a chat word called: upstream's bell as `meet()` rings it, but with upstream's own opening line, and
   * without host.bell, which has Paseo's stand-up notes written. Nobody free is not toasted: the chat's reply is the answer.
   */
  gather() {
    if (!started || stopped) return;
    const toast = host.toast;
    host.toast = () => {};
    try { ringWithEveryone(() => ringBell()); } finally { host.toast = toast; }
  },
```

`world-view.tsx`: after the `meeting` effect add

```text
  useEffect(
    () => onChatAct((what) => { if (what === "meeting") world.current?.gather?.(); }),
    [],
  );
```

- [ ] **Step 4: Run them to see them pass**

Run the four test files with `--bail=1`, then `office/client/office-state.test.ts` and `office/client/world/world-loader.test.ts` once each, since `use-office.ts` and `world-api.ts` moved. Expected: PASS. Then typecheck, lint, format.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/chat-text.ts plugins/office/client/chat-text.test.ts plugins/office/client/chat-seen.ts plugins/office/client/chat-seen.test.ts plugins/office/client/chat-acts.ts plugins/office/client/chat-acts.test.ts plugins/office/client/use-office.ts plugins/office/client/world plugins/office/vendor/my-office/src/office/paseo-entry.js
git commit -m "feat(office): the chat's client text, its seen mark, and a gather call for the scene"
```

---

### Task 6: The panel, the button, the screen, the docs

Needs Tasks 2 and 5; the live check needs Task 4.

**Files:**

- Create: `plugins/office/client/chat-panel.tsx`
- Modify: `plugins/office/client/office-link.ts` (`CHAT_SCREEN = "office-chat"`)
- Modify: `plugins/office/client/office-surface.tsx` (`PanelButton` gains `count`; `PanelButtons` gains Chat)
- Modify: `plugins/office/index.client.tsx` (one `addScreen`)
- Modify: `plugins/office/client/styles.ts` (a `chat*` block at the end)
- Modify: `docs/plugins.md` (one sentence in the office's section), `docs/superpowers/specs/2026-11-17-office-team-chat-design.md` (Status, "Not verified"), `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status: piece 5 built)
- Test: `plugins/office/client/chat-panel.mounted.test.tsx`, `plugins/office/client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Consumes: Task 5's modules; Task 2's `chatRpc`, `ChatMessage`; `useOffice` (with `chat`), `linkOpenSession` from `office-link.ts`; `ActionButton`, `failureText` from `action-button.tsx`; `loadProblem` from `activity-panel.tsx`; `buildOfficeModel`; the kit's `Icon`, `ScrollView`, `TextInput`.
- Produces: `ChatPanel(props: PluginScreenProps)`; `export const CHAT_SCREEN = "office-chat"`; `PanelButton`'s `count?: string | null`.

- [ ] **Step 1: Write the failing mounted tests**

`chat-panel.mounted.test.tsx` is built on `activity-panel.mounted.test.tsx` (the same `useSubscription` stand-in that keeps `onEvent`, the same theme proxy) with the kit's stand-ins: `Icon: () => null`, `ScrollView`, and `TextInput` from `react-native`; `useRpc` returns a `vi.fn` the test reads, one call at a time. It types into the box as `board-sheet.mounted.test.tsx` does (`type(label, text)` through the native value setter and an `input` event).

```text
test("empty: the line that says how to start", ...);                       // CHAT_EMPTY
test("messages oldest first: yours on the right without an avatar, an agent's with initials, name and time", ...);
test("a reply quotes the message it answers; a system line is centred; a recalled one says Message recalled", ...);
test("a sticker is a chip with upstream's words; a photo or work message shows nothing", ...);
test("a poll shows options with counts and your vote, and a press votes", ...);   // call { op: "vote", id, index }
test("a reminder shows its time, Going and Not going, and a press sends rsvp", ...);
test("reactions: counts under a message with your own pressed; React opens the six; the same emoji again sends react", ...);
test("typing words show above the box", ...);
test("an agent's long answer is clipped with Show more, and Open session opens the agent", ...);
  // linkOpenSession through a registered link (useOfficeLink), as activity-panel.mounted.test.tsx does
test("Enter sends and clears the box; Shift+Enter does not send", ...);    // call { op: "send", text }
test("a send that fails leaves the text in the box and shows the error under it", ...);
test("@ lists the team filtered by the words after it; Enter, Tab or a press puts the name", ...);
test("a sticker button opens the eight; a press sends { op: "send", sticker }", ...);
test("Reply quotes the message above the box, and the send carries replyTo", ...);
test("your own message has Recall for two minutes", ...);                    // vi.setSystemTime; then past two minutes it is gone
test("a counter shows from 500 characters", ...);
test("the panel marks the chat seen as messages arrive", ...);              // chat-seen: getChatSeen() equals the newest message's at
test("a subscription that cannot load says so", ...);                        // loadProblem
test("while you are at the bottom a new message scrolls to it, and not when you have scrolled up", ...);
  // the stand-in ScrollView records scrollToEnd calls; fire onScroll with offsets and onContentSizeChange
```

`office-surface-panels.mounted.test.tsx`: extend the existing mock so `useSubscription` keeps its `onEvent` (as the activity-panel test does), then:

```text
test("the header has Chat after Activity, and a press opens the chat beside the floor", () => {
  expect(buttonLabels()).toEqual([..., "Sessions", "Activity", "Chat"]);
  press("Chat"); expect(showBeside).toHaveBeenCalledWith({ kind: "screen", pluginId: "office", screenId: "office-chat" });
});
test("Chat shows the messages since the chat was last open, and none at zero", async () => {
  resetChatSeen(1000);
  // deliver a snapshot with chat.messages at 500 (seen), 2000 (an agent), 3000 (yours), 4000 (a system line) and 5000 (an agent)
  expect(chatButton().textContent).toContain("2");
  // markChatSeen(5000): the count goes
});
test("without showBeside Chat is not there either", ...);
test("a chat change does not rebuild the floor's model", ...);
  // spy on buildOfficeModel through vi.mock of ../shared/model.js (keep the real one): after a snapshot, deliver a chat typing event: the call count does not move
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd plugins && npx vitest run office/client/chat-panel.mounted.test.tsx --bail=1`, then the surface test.
Expected: FAIL.

- [ ] **Step 3: Add the styles**

At the end of the `OfficeStyles` interface add the `chat*` entries, and at the end of the object in `useOfficeStyles` their values. The names and what they are:

```text
chatList: ViewStyle           // the scroller's content: paddingHorizontal pad, paddingVertical 12, gap 8
chatRow: ViewStyle            // one message: flexDirection row, gap 8, alignItems flex-start
chatRowMine: ViewStyle        // chatRow with justifyContent flex-end
chatAvatar: ViewStyle         // 32 x 32, borderRadius 16, alignItems/justifyContent center; backgroundColor comes from avatarOf
chatAvatarText: TextStyle     // small, fontWeight 500, color "#FFFFFF" (the shirts are 3.2:1 or better against white text at 12 px bold)
chatBubble: ViewStyle         // flexShrink 1, maxWidth "80%", paddingVertical 8, paddingHorizontal 12, borderRadius 12, borderWidth 1, borderColor colors.border, backgroundColor colors.surface1, gap 4
chatBubbleMine: ViewStyle     // chatBubble with backgroundColor colors.surface2
chatName: TextStyle           // small, fontWeight 500, color colors.foreground
chatMeta: TextStyle           // small, color colors.foregroundMuted
chatText: TextStyle           // base, color colors.foreground
chatQuote: ViewStyle          // borderLeftWidth 2, borderLeftColor colors.border, paddingLeft 8
chatSystem: TextStyle         // small, centred, color colors.foregroundMuted, paddingVertical 4
chatChip: ViewStyle           // a sticker: chip's border, paddingHorizontal 12, minHeight 28, borderRadius 9999
chatReactions: ViewStyle      // flexDirection row, flexWrap wrap, gap 4
chatReaction: ViewStyle       // chip-shaped, small
chatReactionOn: ViewStyle     // chatReaction with the segment fill's colour (colors.foregroundMuted at 0.2 opacity is a layer: use borderColor colors.foreground instead)
chatActions: ViewStyle        // the hover/focus row: flexDirection row, gap 8
chatTyping: TextStyle         // small, muted, paddingHorizontal pad
chatBox: ViewStyle            // the composer: padding pad, gap 8, borderTopWidth 1, borderTopColor colors.border
chatMentions: ViewStyle       // the @ list: borderWidth 1, borderColor colors.border, borderRadius 8, backgroundColor colors.surface1, maxHeight 224
chatBadge: ViewStyle          // the header count: minWidth 16, height 16, borderRadius 8, paddingHorizontal 4, backgroundColor colors.accent, absolute top -4 right -4
chatBadgeText: TextStyle      // fontSize 10, lineHeight 16, fontWeight 500, color "#FFFFFF"
```

Each uses the file's own `base`, `small`, `pad` and the theme's `colors` as the `panel*` block does; nothing hard-coded but the white on a coloured disc.

- [ ] **Step 4: Write the panel**

`chat-panel.tsx` exports `ChatPanel`. Its structure, as code the executor completes by reading the Activity panel beside it for the `Pill`/`Pressable` hover pattern:

```text
export function ChatPanel({ theme, layout, navigation }: PluginScreenProps) {
  const styles = useOfficeStyles(theme, layout.compact, false);
  const { state, subscription, chat } = useOffice();
  const call = useRpc(chatRpc);
  const model = useMemo(() => buildOfficeModel(state), [state]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const messages = useMemo(() => (chat?.messages ?? []).filter(shows), [chat]);
  const problem = loadProblem(subscription);
  // marks the chat seen while it is open
  const newest = messages.at(-1)?.at ?? 0;
  useEffect(() => { if (newest > 0) markChatSeen(newest); }, [newest]);
  // stays at the bottom while you are there
  const atBottom = useRef(true);
  const scroller = useRef<ScrollView>(null);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 24;
  }, []);
  const onContentSizeChange = useCallback(() => { if (atBottom.current) scroller.current?.scrollToEnd({ animated: false }); }, []);

  const run = useCallback(async (input: ChatRequest): Promise<boolean> => {
    try {
      const result = await call(input);
      if (!result.ok) throw new Error(result.error);
      setError(null);
      return true;
    } catch (failure) {
      setError(failureText("Send", failure));   // "Unable to send: ..." under the box
      return false;
    }
  }, [call]);
  const send = useCallback(async () => {
    const sent = text.trim();
    if (sent === "") return;
    const ok = await run({ op: "send", text: sent, ...(replyTo ? { replyTo: replyTo.id } : {}) });
    if (ok) { setText((current) => textAfterSend(current, sent)); setReplyTo(null); }
  }, [text, replyTo, run]);
  ...
}
```

Parts, each a small component in the same file:

- `Avatar({ message })` from `avatarOf`: a round `View` with the initials, `backgroundColor` from `avatarOf(...).color`; none for yours and for system lines.
- `Message({ message, ... })`: the row for each kind. System: centred `chatSystem` text. Yours: `chatRowMine`, `chatBubbleMine`, no avatar or name; the time under it. Others: avatar, name, `timeLabel(message.at, Date.now())`, the quote (`message.reply`) as `chatQuote` with its `name` and `text`, then the body by kind: `text` (with `isLong` clipped by `numberOfLines={SHOW_MORE_LINES}` until `Show more` is pressed, and `Open session` under an agent's answer when `message.from` is an agent in `state.agents`: `linkOpenSession(message.from, navigation)`), `sticker` (`STICKERS[message.sticker ?? 0]` in a `chatChip`), `poll` (`Pressable` options from `pollRows`, role `radio`, `aria-checked`, `run({ op: "vote", id, index })`), `remind` (from `remindState`: its title, `when`, `going` and two buttons `Going` and `Not going` sending `rsvp`). A recalled message shows `CHAT_RECALLED`, no reactions, no actions.
- Reactions under a message: `reactionRows(message)` as `chatReaction` buttons (`aria-pressed={mine}`), each sending `{ op: "react", id, emoji }`. The row's actions (`React`, `Reply`, and `Recall` when `canRecall`) are shown on hover and focus on web and always on a phone, by the repo's rule (`isHovered || isNative || isCompact`; use `layout.compact` here, and `onHoverIn`/`onHoverOut` on the row's `Pressable` as the Sessions rows do). `React` toggles a row of `REACTION_CHOICES`.
- The box: `TextInput` (`multiline`, `maxLength={CHAT_TEXT_MAX}`, `accessibilityLabel="Message"`, `onKeyPress` that on web calls `event.preventDefault()` and `send()` when `enterSends(event.nativeEvent)` and no mention is open), the `counterText(text.length)` line, the Send `ActionButton` (`primary`), a sticker button (`message-circle` is the header's icon; use `Smile` here) that toggles the eight stickers, the `Reply` quote above the box with a close, and `error` under it.
- The `@` list: `mentionAt(text)`, `mentionOptions(model, mention.query)` under the box as `chatMentions` rows. A press, Tab, or Enter on the first option (while the list is open Enter picks and does not send) sets `text` to `putMention(text, mention, option.name)`. No list while there is no option.
- Above the box: `typingText(chat?.typing ?? [])`. Empty list: `CHAT_EMPTY`. A load problem: the Activity panel's problem text in place of the list.

`office-link.ts`: add `export const CHAT_SCREEN = "office-chat";` after the other two.

`office-surface.tsx`: `PanelButton` takes `count?: string | null` and, when set, draws `<View style={styles.chatBadge}><Text style={styles.chatBadgeText}>{count}</Text></View>` over the icon and uses `accessibilityLabel={count ? `${label}, ${count} new` : label}`. `PanelButtons` takes `unread: string | null` (the surface computes it with `unreadLabel(unreadCount(office.chat?.messages ?? [], useChatSeen()))`) and adds, after Activity:

```text
      <PanelButton label="Chat" icon="MessageCircle" screenId={CHAT_SCREEN} size={size} color={color} count={unread} onOpen={open} styles={styles} />
```

`index.client.tsx`: `client.addScreen({ id: CHAT_SCREEN, title: "Chat", Component: ChatPanel }),` after Activity's.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd plugins && npx vitest run office/client/chat-panel.mounted.test.tsx --bail=1`, then `office/client/office-surface-panels.mounted.test.tsx`, then `office/client/office-surface.test.ts`, `office/client/sessions-panel.mounted.test.tsx` and `office/client/activity-panel.mounted.test.tsx` once each (the surface and `use-office` moved).
Expected: PASS. Then typecheck, lint and format every changed file.

- [ ] **Step 6: Look at it**

Start a dev daemon of this worktree (`npm run dev`; never port 6767) and open the office on the web at 1280 x 800 and 390 x 844. Check: the Chat button after Activity with no count at first; a message from the box appears on the right; an `@` to a real agent starts a typing line and its prompt shows in that agent's session as `Team chat message from you: ...`; the agent's answer comes back as a reply that quotes the message, clipped with `Show more` when long, with `Open session` opening the agent beside the floor; the count on the button while the chat is closed; a reaction and its count; the word "meeting" rings the bell on the 3D floor and does not start the stand-up notes writer; the chat is still there after restarting the dev daemon, and the pending answer is not. In the dev daemon's `daemon.log` find no `[office] chat` error. Confirm the 3D scene does not call `setSessions` again on a chat change (a `console.count` in `world-view.tsx`'s effect, removed afterwards).

- [ ] **Step 7: Docs**

In `docs/plugins.md`, in the office's section after the sentence on the header's Sessions and Activity buttons, add one sentence on its own line: the Chat button opens the team chat beside the floor; the conversation is upstream's engine running on the office's server (`plugins/office/server/chat-service.ts`), kept in `<PASEO_HOME>/office/chat.json`, and an `@` to an agent prompts it and posts its answer; agents' lines come from the directory and the turn hooks, so they come while an office or a panel is open. In the team chat spec set Status to built and add a "Not verified" list of what Step 6 did not cover. In the owner-review spec mark piece 5 built.

- [ ] **Step 8: Commit**

```bash
git add plugins/office/client/chat-panel.tsx plugins/office/client/chat-panel.mounted.test.tsx plugins/office/client/office-link.ts plugins/office/client/office-surface.tsx plugins/office/client/office-surface-panels.mounted.test.tsx plugins/office/client/styles.ts plugins/office/index.client.tsx docs/plugins.md docs/superpowers/specs/2026-11-17-office-team-chat-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "feat(office): the Chat button and panel beside the floor"
```

## Order

Tasks 1 and 2 can run in parallel. Tasks 3 and 5 both need 1 and 2 and can run in parallel with each other. Task 4 needs 2 and 3. Task 6 needs 2 and 5 for its tests and 4 for the live check, so start it once 5 is done and finish it after 4.

## Self-review

- **Spec coverage.** Engine vendored and imported by the importer (Task 1). Team, staff, storage, sending, `act`, clock (Tasks 2, 3, 4, 5). Events table (Task 3 tests, one per row). Talking to agents: the call, prompts, gone, working, answer, restart (Tasks 2, 3, 4). Panel: button and count (Tasks 5, 6), messages, kinds, answers, reactions, typing, box, empty, errors (Task 6). Components list: every file is in a task, with `gather()` in Task 5 and `SOURCES.md` in Task 1. Errors (Task 3 tests). Testing section: service tests (Task 3), contracts (Task 2), `chat-text` unit tests (Task 5), the mounted panel and the header (Task 6), the live check (Task 6 Step 6).
- **Placeholders.** The test lists in Tasks 3 and 6 name each test and say what it asserts; their bodies are for the executor to write in full against the harness shown, which is the one place this plan does not print code. Everything that other tasks call has its signature printed.
- **Types.** `ChatService`, `ChatServicePorts`, `ChatSnapshot`, `ChatChange`, `ChatRequest`, `ChatResult`, `ChatMessage`, `ChatStore`, `ChatData`, `EngineMessage`, `Translate` are defined once (Tasks 1 to 3) and used by those names. `OfficeState.chat` (Task 5) is what Task 6 reads. `CHAT_SCREEN` is `office-chat` in Tasks 6.
