# The office's janitor: design

Date: 2026-11-16. Status: built. Sub-project 5 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

From Hermes3D's list: "Reset sessions and clean context with the janitor system."

## What was there

Hermes3D's janitor is an animation: when a session is reset, three cleaners walk through its
office for a minute. The reset itself happens in its chat. The vendored my-office scene draws a
session's context as paper: a stack in a tray on the desk, a bin that fills, a flag in the stack
from 85%, and a trip to the shredder when the session compacts. None of it was fed: the office
did not know how full a context is. Paseo's agents report it (`lastUsage` has the tokens used and
the window's size), and providers have their own commands to compact a conversation and to start
a new one.

## Decisions

| Question                    | Decision                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What "clean context" is     | A compaction: the provider's `compact` command. The agent keeps a summary of the conversation.                                                                                                                                                                                                     |
| What "reset session" is     | A new conversation in the same agent: the first of the commands `clear`, `new` and `reset` that the agent's session lists. The agent keeps nothing of the old one. Its files and commits stay, and so does the agent's timeline in Paseo.                                                          |
| How they are sent           | As a prompt, `/compact` or `/clear`, through the SDK's `send`. The office asks the session for its commands first (`commands()`), so a provider without one answers with a sentence and gets no prompt it would read as text.                                                                      |
| Who can be tidied           | An agent that is idle or stopped on an error. A context that grew too long is one reason an agent stops, so the error state is not excluded. An agent at work, one that waits for an answer and one that starts are refused: the command would cut the turn.                                       |
| Asking twice                | A reset asks for a second press within 5 s, as Saved prompts does: the plugin kit has no confirm dialog. Cleaning does not ask: nothing is lost that the provider would not compact on its own.                                                                                                    |
| Where the numbers come from | `lastUsage.contextWindowUsedTokens` and `contextWindowMaxTokens` of the agent's snapshot, carried on the office's agent as `context`. Absent for a provider that reports none, and before an agent's first turn.                                                                                   |
| After a reset               | A provider says how full a context is when a turn ends, so the old number would stay until the next turn. The hub remembers the number a reset agent had and reads its context as empty while the provider still says that number.                                                                 |
| Where it shows              | A Janitor entry after Host in the attention strip, in all three views: how many contexts are nearly full, else the fullest one. It opens the Janitor card: every agent, the fullest first, a meter, and the two buttons. An agent's own card says how full its context is.                         |
| Tones                       | Nearly full from 85%, the scene's own line for its flag, and full from 95%. Below that the meter is grey, so a colour means something.                                                                                                                                                             |
| The card's order            | Sorted when it opens. While it is open the rows stay where they are: a row whose context empties must not move another row's buttons under a finger.                                                                                                                                               |
| In the 3D office            | The scene gets each session's `usage`, so the paper on the desks and in the bins is real, with the flag from 85%. A context that falls to less than half of what it was, and by at least a tenth of the window, is told as upstream's `compact` event: the person takes the paper to the shredder. |
| In the 2D office            | A tray on each desk: one row of paper per third of the window, a flag from 85%. A janitor stands by a cart in the lounge; the two are the button for the Janitor card. When a context empties the janitor walks to that desk and sweeps, and the tray is empty once that is done.                  |
| Which of the two it was     | Not told apart on the floor. A compaction and a new conversation both show as a context that emptied: the office reads the number, not the timeline.                                                                                                                                               |
| Reduced motion              | The janitor stays at the cart and a tray is empty at once.                                                                                                                                                                                                                                         |

## Components

- `shared/contracts.ts`: `context` on the office's agent, `office.janitor.request`.
- `server/directory.ts`: `context` from `lastUsage`; `settleResets`, pure: the agents with a reset
  one's context read as empty, and the resets that still hold.
- `server/janitor.ts`: `tidyAgent`, over three ports: the agent's status, its session's commands,
  a send. `server/live-ports.ts` has them on the daemon's API.
- `server/hub.ts`: `contextReset(agentId)`.
- `client/context-text.ts`: the percent, the tones, the card's rows and their words.
- `client/janitor-card.tsx`, `client/use-janitor.ts`: the card and its call.
  `client/attention-strip.tsx` has the Janitor entry.
- `client/world/adapter.ts`: `usage` on a session, and the `compact` event in `worldChanges`.
- The scene's entry: `TYPE_ICON.compact` is the paper icon. The wording stand-in has the lines
  that fit a reset as well as a compaction.
- `client/pixel/actors.ts`: `trayOf`, and the janitor's round (`visitsAfter`, `visitsSwept`).
  `client/pixel/floor-plan.ts` places the cart and the janitor in the lounge;
  `client/pixel/art.ts` has the tray, the cart, the janitor and the broom;
  `client/pixel/pixel-office.tsx` has `JanitorView` and `JanitorButton`.

## Errors

- A refusal comes back as `{ ok: false, error }` and shows under the row's buttons, after
  "Unable to clean the context" or "Unable to reset the session".
- The answer says the command was sent. What the provider does with it shows as the agent's
  state: at work while it compacts, then a smaller number.
- A reset the provider did not carry out reads as empty until the next turn reports a number.

## Not built

- Hermes3D's crew of three and its minute-long sweep: one janitor, one desk at a time.
- A janitor in the 3D office. Upstream's cleaner is among the people the port left out, and the
  shredder trip is upstream's own picture of a compaction.
- Cleaning or resetting several agents at once.
- Telling a compaction from a new conversation on the floor.

## Testing

Unit tests: the projection and `settleResets`, `tidyAgent`, the hub's reset, the RPC through the
plugin entry, the card's words and order, `worldChanges` for a context that empties, the tray's
levels, the janitor's round and the lounge's plan at each width.

Live, with fixtures in front of a dev daemon and no agent created: the strip entry and the card
at 390 px (light and dark) and 1280 px (dark); a refusal from the real daemon under the row; the
second press of a reset; the janitor's walk, sweep and return at 390 px, and two desks in a row
at 1280 px; hover, keyboard focus and Enter on the cart, and focus back on it after Escape;
320 px; reduced motion; the list view; the 3D office telling "Off to shred the paper".

## Not verified

- A compaction or a reset of a real agent: the hard rule of this build is that no agent is
  created or prompted, so the answers were rewritten in the test proxy. Whether a provider other
  than Claude lists a command for either is not known.
- Whether Claude reports a new number right after `/clear`. The hub's reset covers both cases.
- The 3D paper stacks at a size that can be read in a picture: the test browser draws the scene
  at about 1.5 frames a second and the stacks are small at the default camera.
- The installed app on a phone or a tablet.
