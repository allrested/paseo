# The office's team chat: design

Date: 2026-11-17. Status: built. Piece 5 of sub-project 7 ("Upstream's controls") of
[the office after the owner's review](2026-11-16-office-owner-review-design.md). The owner's answers
on how sub-project 7 splits are in [piece 1's design](2026-11-17-office-list-mode-design.md#the-owners-answers).
It opens beside the floor as [Sessions and Activity](2026-11-17-office-side-panels-design.md)
(piece 3) do.

## Request

Point 18 of the owner's review:

18. Upstream's team chat is missing.

## The owner's answers

| Question                          | Answer                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How much of upstream's chat       | A chat that talks to agents: one conversation kept by the office's server, agents posting about their work, the office's life and banter, reactions and polls; an @mention prompts the agent and its answer comes back. Not upstream's CI, loop and denied cards, push notifications, prompt rewriting or voice. |
| An @mention to an agent in a turn | The message joins the running turn, as the board's wake sends one from you.                                                                                                                                                                                                                                      |
| Where it opens                    | Beside the floor: a third header button, Chat, after Sessions and Activity, with an unread count. A phone opens it as its own screen.                                                                                                                                                                            |
| How it is built                   | Upstream's engine, vendored unchanged and run on the office's server, with a new React panel.                                                                                                                                                                                                                    |

## What was there

- Upstream's chat is three parts. `src/shared/chat-engine.js` (231 lines) is the conversation:
  messages, typing, reactions, polls, reminders, replies, recalls, a clock for the office's life,
  and lines for a session's events. It knows nothing of pages or files; its host passes `ctx`:
  `tr`, `now`, `members()` (`{ id, name, status, task, project }`), `staffName(key)`,
  `store { load, save }`, `emit(op, payload)` with `add`, `update`, `typing`, `all`, `act(what)`
  and `timer`. Upstream's server (`server/index.mjs`) runs one engine for every page and keeps it
  in `data/chat.json`. `src/office/ui/group-chat.js` (214 lines) and `group-chat-view.js` (938
  lines) are the page's side; the view imports the task sheet, the vault, the burn chart, the CI,
  loop and denied cards, voice, push and the prompt coach.
- The engine's words are upstream's `chat` locale area. A line from someone `who()` cannot name is
  dropped without a word (`say` returns), so a staff key the host does not name is silent.
- `send` posts your message, then each @named member answers with what they are on
  (`statusOf`). `working(from, on)` shows "<name> is typing…" for as long as someone works on what
  you sent them. `onEvent` turns a session's events into lines (`start`, `prompt`, `stop`, `wait`,
  `ask`, `fail`, `substart`), each at most once per a few minutes.
- Of upstream's staff the vendored scene has the director (`people/director.js`). Reception, the
  cleaner (`people/staff.js`), HR, the guard and the accountant are stand-ins with nobody on the
  floor. The Friday tea (`people/teatime.js`) is a stand-in.
- The office's server already: follows every agent's status, permissions and timeline tail
  (`server/activity.ts`, `server/paseo-directory.ts`); sends the page `office.state`, a snapshot
  then changes (`shared/contracts.ts`); keeps the board in a file under `<PASEO_HOME>/office/`
  with queued saves that swap into place (`server/board-store.ts`); sends a prompt from you to an
  agent so it steers a running turn (`server/live-ports.ts`, `send(agentId, prompt, null)`).
- A timeline's `assistant_message` items carry the agent's text; Paseo's protocol already joins
  the last message's parts (`packages/protocol/src/agent-attention-notification.ts`).
- Piece 3 put Sessions and Activity in the header after the view switch; a press calls
  `navigation.showBeside({ kind: "screen", pluginId: "office", screenId })`, and both are hidden
  without `showBeside`. Their screens read the office's state through the office link
  (`client/office-link.ts`).

## Approaches

| Approach                                                    | Trade-off                                                                                                                                                 | Chosen |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Upstream's engine on the office's server, a new React panel | Upstream's banter, typing, reactions and polls as they are; the server is the one place that keeps the conversation, as upstream's. The view is new code. | Yes    |
| Upstream's view as well, in the side area                   | Upstream's look, but a dozen modules the owner left out would need stand-ins.                                                                             | No     |
| A smaller chat written for Paseo                            | Easier to test; no banter, typing, polls or office life.                                                                                                  | No     |

## Decisions

### The engine

| Question   | Decision                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The file   | `vendor/my-office/src/shared/chat-engine.js`, upstream's, unchanged. `import-upstream.mjs` copies it and the English `chat` area.                                                                                                                                                                                 |
| One engine | Made when the office's server starts, before any page subscribes.                                                                                                                                                                                                                                                 |
| The team   | `members()` is the office's agents that are not archived: the name the floor shows (a sub-agent's is "Mjd-1"), `status` `rest` when idle and `work` otherwise, `task` its title, `project` its folder's name.                                                                                                     |
| Staff      | `staffName` names the director only (upstream's English "Director"). Every other key returns null, so lines from reception, HR, the cleaner, the guard, the courier and the accountant are dropped: the morning hello and the Monday and Friday reminders do not come. The lunch poll still comes, from an agent. |
| Storage    | `<PASEO_HOME>/office/chat.json`, with the board store's queued save that swaps into place. A file that does not parse is moved aside and the chat starts empty, as the board does. Upstream's limits: 300 messages.                                                                                               |
| Sending    | `emit` puts a `chat` change in `office.state`: `{ op: "add" \| "update", message }`, `{ op: "typing", names }` or `{ op: "all" }` followed by the whole conversation. The snapshot carries `chat: { messages, typing }`.                                                                                          |
| `act`      | `meeting` asks the open scenes to gather people at the bell (`ringBell` in `people/gatherings.js`) without `host.bell`, so the stand-up notes writer does not start. `tea` does nothing. My call: a word in a chat does not spend an agent's tokens.                                                              |
| The clock  | `clock()` every 30 s, as upstream.                                                                                                                                                                                                                                                                                |

### What agents say on their own

| Office event            | Engine event                                         |
| ----------------------- | ---------------------------------------------------- |
| An agent appears        | `start`                                              |
| A turn ends             | `stop`                                               |
| A permission waits      | `wait`; a question (`ask` permission kind) `ask`     |
| A turn ends in an error | `fail`, with `limit` when the error is a usage limit |
| A sub-agent appears     | `substart` with `agent` on its parent                |
| An agent is archived    | `onLeft`                                             |

A prompt typed elsewhere in Paseo is not passed (`prompt` is never sent). My call: the chat is for
the chat; the floor and the session show those.

### Talking to agents

| Question   | Decision                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The call   | `office.chat.request` with `op`: `send { text, sticker?, replyTo? }`, `react { id, emoji }`, `vote { id, index }`, `rsvp { id, yes }`, `recall { id }`. Each goes to the engine's function of that name.                                                                                          |
| Send       | The engine posts it and each @named agent answers with what it is on, at once.                                                                                                                                                                                                                    |
| Prompts    | For each `@Name` in the text that is a member, the office sends `Team chat message from you: <text>` to that agent with `send(agentId, prompt, null)`, so it steers a running turn. One message to two agents is two prompts.                                                                     |
| Gone       | An archived agent is not a member, so its @name matches nobody: no prompt and no answer. It left with `onLeft`'s line.                                                                                                                                                                            |
| Working    | `working(agentId, true)` from the send until that agent's turn ends, so the chat shows it typing.                                                                                                                                                                                                 |
| The answer | When that turn ends, the last assistant message is read from the timeline tail and posted with `say(agentId, text, { now: true, long: true, reply })`, `reply` quoting your message, clipped to 1,200 characters with "…". A turn that ends in an error posts nothing more: `fail` already spoke. |
| Restart    | A prompt waiting for its answer is kept in memory only. After a restart of the daemon, its answer does not come back to the chat. My call: the answer is in the session.                                                                                                                          |

### The panel

| Question          | Decision                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The button        | Chat (`message-circle`), after Activity, hidden without `showBeside`. A count of messages since the chat was last open, kept per device in `localStorage` under `office-chat-seen`; none at zero. A press calls `showBeside` with screen `chat`.                                                                                                                                  |
| Messages          | Oldest first, scrolled to the newest, and kept there while you are at the bottom. Each has a round avatar with the person's initials in their floor colour (the director's is upstream's), the name and the time; yours are on the right without an avatar. A reply quotes the message it answers. A system line is centred and small.                                            |
| Kinds             | Text; a sticker (upstream's English words) as a chip; a poll with its options, counts and your vote, a press votes; a reminder with its time and Going / Not going; a recalled message as "Message recalled". A photo, work, loop, CI or denied message never comes; one in the file shows nothing.                                                                               |
| An agent's answer | Clipped at eight lines with "Show more"; "Open session" opens the agent beside the floor, as the agent card does.                                                                                                                                                                                                                                                                 |
| Reactions         | Upstream's six under a message, each with its count; your own is pressed. "React" on a message (shown on hover and focus on web, always on a phone) opens the six; the same emoji again takes it back.                                                                                                                                                                            |
| Typing            | "<name> is typing…", "<a> and <b> are typing…", "Several people are typing…" above the box.                                                                                                                                                                                                                                                                                       |
| The box           | A multi-line field. Enter sends, Shift+Enter is a new line. `@` lists the team, filtered by the words after it with the List's search (`list-text.ts`); Enter, Tab or a press puts `@Name `. A counter shows from 500 of 600 characters. A sticker button opens the eight stickers. Reply on a message quotes it above the box. Your own message can be recalled for two minutes. |
| Empty             | "No messages yet. @ an agent to give it work."                                                                                                                                                                                                                                                                                                                                    |
| Errors            | A call that fails leaves the text in the box and shows the error under it.                                                                                                                                                                                                                                                                                                        |

## Components

- `vendor/my-office/src/shared/chat-engine.js` and the `chat` locale area: upstream's.
- `vendor/my-office/import-upstream.mjs`: copies `shared/chat-engine.js` and the `chat` area.
- `server/chat-service.ts`: makes the engine with its `ctx`, turns office events into engine
  events, sends prompts and posts answers.
- `server/chat-store.ts`: `chat.json`, on the board store's queue.
- `shared/contracts.ts`: `chatRpc`, the chat message schema, `chat` in the state and its changes.
- `index.server.ts`: the service, the call, the clock.
- `client/chat-text.ts`: time labels, typing words, @ matching, the unread count, reactions.
- `client/chat-panel.tsx`: the screen.
- `client/office-surface.tsx` and the plugin's screens: the button and the `chat` screen.
- `client/world/world-api.ts` and `vendor/my-office/src/office/paseo-entry.js`: `gather()` for
  the `meeting` act.
- `vendor/SOURCES.md`: the engine is taken; its staff and its acts in Paseo.

## Errors

- A save that fails: logged; the conversation stays in memory and the next save tries again.
- A prompt that fails to send: the system line "Could not reach <name>: <error>."
- An answer that cannot be read: nothing is posted; the agent stops typing.

## Not built

- Photos, starting a poll, pins, the task sheet, the vault, the burn chart, CI, loop and denied
  cards, voice, push notifications and prompt rewriting.
- Chibi portraits as avatars: upstream draws them with the scene's renderer, which the side area
  does not have.
- Answers that come back after a daemon restart.

## Where the build departs from this design

The engine and its English `chat` area are in `plugins/office/shared/upstream/`, not
`vendor/my-office/src/`: the plugin compiler bundles only `client/`, `server/` and `shared/`
(`docs/plugins.md`). `import-upstream.mjs` still copies both from upstream unchanged. The chat
shows upstream's lines with their emoji; the scene's stand-in strips emoji for its speech bubbles,
and the chat does not use it.

## Testing

Unit, with a fake clock and a temp folder: the team and the director only; storage across a
restart; a file that does not parse; each office event to its line; `send` with two @names sends
two prompts that steer, shows them typing, and posts each answer as a reply when its turn ends;
an archived name; an error turn; the `meeting` act gathering without the bell's writer.

Contracts: the call and the `chat` change parse.

Client: `chat-text.ts` unit tests; a mounted test of the panel with messages, a reply, a poll vote,
a reaction, the @ list and the error under the box; the header's button order, its unread count,
and the button hidden without `showBeside`.

Live, against the daemon: the chat beside the office, an @mention to a real agent and its answer,
on web at 1280 x 800 and 390 x 844.

## Not verified

The live check ran on 2026-11-17 against a dev daemon of this branch on its own port and home,
with Expo web in the Paseo browser at 1280 x 800 and one Claude agent made on that daemon. It was
cut off by a rate limit. Seen: the Chat button after Sessions and Activity, opening the chat beside
the floor; Enter and the Send button sending, your message on the right; agent start lines; the
`@` list opening, filtering, empty on no match and closing after a pick; an `@` to the agent
showing it typing for about four seconds, its status reply and then its answer, both quoting your
message, the answer clipped with Show more and with Open session; no `[office] chat` line in
`daemon.log`. React and Reply showed on every message in the side area on desktop; that was fixed
after the check (the actions follow the touch screen, not `compact`) and not looked at again.
Not seen:

- 390 x 844.
- The prompt text in the agent's session.
- Show more and Open session pressed.
- The unread count while the chat is closed.
- Reactions.
- "meeting" ringing the bell on the 3D floor without the notes writer.
- A restart keeping the chat and dropping a pending answer.
- The 3D scene not re-sent its people on a chat change. `office-surface-panels.mounted.test.tsx`
  covers that a chat change does not rebuild the floor's model.
- Emoji in upstream's lines.
