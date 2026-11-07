# Usage heads-up — design

Date: 2026-11-06. Status: approved design; not yet planned. Builds on
[session move](2026-11-05-session-move-design.md).

## Problem

The session-move banner speaks only after a turn has already failed on the account's limit. By then
the agent stopped mid-task. The usage schema has a `runsOutAt` field for each window, and the Usage
screen and `paseo usage` already display it, but no usage source fills it in, so nothing warns that
an account is about to run out.

## Scope

In scope:

- A pace projection that fills `runsOutAt` for any usage source that leaves it empty.
- A heads-up notice on the agent screen before the account runs out, with a one-click move to the
  best target.
- One notification when an account window crosses 80% and again at 95%.

Out of scope: moving agents automatically, and per-model or per-agent quotas.

## Decisions

| Question              | Decision                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Where it lives        | Fork core, next to session move. The notice sits in the move banner, and the projection has to cover every usage source. |
| When the notice shows | A window of the agent's current account is at 80% or more, or is on pace to run out before it resets and within 3 hours. |
| Danger tone           | 95% or more, or a run-out within 30 minutes.                                                                             |
| Order in the banner   | The limit notice, then the heads-up, then "Moved from".                                                                  |
| Best target           | Available and not current; steady before on pace to run out, then lowest `usedPct`; a tie goes to the same CLI family.   |
| Dismiss               | Hides it for the account window until the next level (80%, then 95%), a reset, or a dismissed warning turning to danger. |
| Protocol              | Move targets gain optional `runsOutAt` and `windowLabel`. Both are additive and optional.                                |

## Pace projection

The usage registry keeps the samples (`fetchedAt`, `usedPct`) of every account window for the last
2 hours. A drop in `usedPct` means the window reset and clears that window's samples. With at least
two samples 10 minutes apart and a rising `usedPct`, the burn rate is the slope between the oldest
and newest sample. When a source leaves `runsOutAt` empty, the registry sets it to
`now + (100 − usedPct) / rate`, but only when that time falls before `resetsAt`. Otherwise
`runsOutAt` stays empty. A source that sets `runsOutAt` itself keeps its value.

With the field filled, the existing Usage screen and `paseo usage` show the projected run-out for
every provider without UI changes.

## Heads-up notice

The banner reads the agent's move targets, as it already does, while its panel is active, every
5 minutes (the lifetime of the daemon's usage cache). The current target carries the tightest
window's `usedPct`, `resetsAt`, `runsOutAt`, and `windowLabel`.

Example: **Claude (work) 84% of weekly · on pace to run out Thu 14:00, resets Fri 09:00**, with
**Move to Kiro CLI · 12%**, **More…** (the move dialog), and a dismiss control. Move goes through the
same path as the move dialog and continues automatically. With no available target the notice shows
only the facts and **More…**.

## Notification

The daemon tracks the highest level (80% or 95%) each account window has crossed since its last
reset. On a new crossing, while at least one agent on that account is running, it sends one
notification through the existing agent notification pipeline. The notification names the agent and
the best target, and tapping it opens the agent. The plan starts by confirming the pipeline can carry
this payload; if it cannot, the notification is dropped from this feature rather than built on a
second path.

## Testing

- Unit: the projection (the rate from samples, no `runsOutAt` when the run-out falls after the reset,
  a single sample, a reset clearing the samples, a source's own `runsOutAt` kept); the heads-up rules
  (thresholds, danger tone, dismissal levels and tone, banner order); the best-target choice.
- Banner view tests next to the existing `move-banner-view.test.ts`.
- Manual: a fake usage source whose usage rises quickly. The heads-up appears at 80% and turns
  danger at 95%; the Usage screen shows the run-out time; Move to the suggested target works.
