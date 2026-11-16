# The office's small fixes, again: design

Date: 2026-11-16. Status: built. Sub-project 6 of
[the office after the owner's review](2026-11-16-office-owner-review-design.md), which has the
request, what the code did before, and the list of sub-projects.

## Request

Points 11, 12 and 14 of the owner's review:

11. A sub-agent is named after its parent with a number (Mjd-1, Mjd-2), not its task, so the 3D
    office looks tidy.
12. The strip of cards over the office looks cut off at its edge.
13. The glide after a drag with the mouse is jerky; upstream's is smooth.

## The owner's answers

| Question              | Answer                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A sibling archived    | Numbers never change. Mjd-2 stays Mjd-2 after Mjd-1 is archived; the next new one is Mjd-3. A sub-agent of Mjd-2 is Mjd-2-1. |
| The design as a whole | Approved as played back, with the calls marked below.                                                                        |

## Approaches

| Approach                                        | Trade-off                                                                           | Chosen |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| The office's own name, numbers stored on agents | Inside the plugin. Stable names. The rest of Paseo still shows the task.            | Yes    |
| Rename the agents                               | The name shows everywhere, but needs a daemon change and overwrites the task title. | No     |
| Numbers from creation order, nothing stored     | No storage, but names shift when a sibling is archived, against the owner's answer. | No     |

## Decisions

### Sub-agent names

| Question               | Decision                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The name               | `<parent's office name>-<number>`. An agent without a parent, or whose parent the office does not show, keeps its own title.                                                                                                              |
| The number             | Kept in the sub-agent's metadata under `office.subagent.number`. The parent keeps the next number under `office.subagent.next`. Both are written by the office's server through the agent's `setMetadata`.                                |
| Handing one out        | When the office's directory sees a shown sub-agent with no number and a shown parent: the larger of the parent's `next` (1 when unset) and one more than its highest numbered child. Several at once go in creation order, one at a time. |
| Existing sub-agents    | Numbered the same way the first time the office sees them. My call.                                                                                                                                                                       |
| Before it is stored    | The sub-agent shows its own title. A write that fails is logged and tried again on the directory's next change.                                                                                                                           |
| Where it shows         | Every place the office names an agent: the 3D tags, the 2D floor, the list, the strip, the cards, the stand-up. The agent's card shows the task title under the name when they differ. The rest of Paseo is unchanged.                    |
| Where it is worked out | Once, on the office's server, into an optional `name` on the office's agent. The client's `agentTitle` reads it.                                                                                                                          |

### The card strip

| Question    | Decision                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wide screen | The cards wrap onto further rows. No sideways scroll. My call.                                                                                      |
| Phone       | The cards scroll sideways as now, with a 24 px fade to the surface colour at the right edge while more cards are past it, gone at the end. My call. |

### The glide

| Question  | Decision                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The cause | Upstream's loop (`core/loop.js` `frameGap`) draws 8 frames a second while its document has no focus, and the office's frame hands focus back to Paseo's page after each press, so the glide after a drag runs at 8 frames a second. |
| The fix   | The scene's entry (`paseo-entry.js`) makes the frame's `document.hasFocus()` answer for Paseo's page: true while the page the frame is in has focus. The frame is same-origin (`srcdoc`). Upstream's loop is unchanged. My call.    |

## Not built

- The sub-agent name outside the office.
- A way to rename or renumber an agent in the office.

## Verified

- Unit: numbering in creation order, ties by id, no reuse after an archived sibling, a parent's
  counter brought up to date, hidden parents, bad stored values; nested names (Mjd-2-1); the hub
  writes each number once and again after a failed write; `agentTitle` and the task line.
- Mounted: the strip wraps with no sideways scroll on a wide screen and scrolls on a phone; the
  fade's rule at the start, the middle and the end.
- Browser: the built scene in a frame inside a page in headless Chromium. With the outer page
  focused, the frame's own `hasFocus()` is false and the scene's is true. Sub-agents of "Mjd" carry
  the tags "Mjd-1" and "Mjd-2". The scene bundles at 1.07 MB, under its 1.2 MB bound.

## Not verified

- The glide's frame rate itself: the test browser draws with software at a few frames a second.
- The office inside the app with real agents: the numbers written through `setMetadata` and
  read back, and the strip and its fade on a real phone.
