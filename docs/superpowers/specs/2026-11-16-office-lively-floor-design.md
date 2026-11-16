# The office's lively floor: design

Date: 2026-11-16. Status: built, with the four follow-ups of its review. Sub-project 2 of
[the office after the owner's review](2026-11-16-office-owner-review-design.md), which has the
request, what the code did before, and the list of sub-projects.

## Request

Points 1 and 2 of the owner's review:

1. An idle agent sleeps at its desk. It should use the lounge: pool, a nap on the sofa, the games
   TV, foosball, the karaoke box, feeding the fish, the arcade machine, a cup in the dining room,
   the restroom. "I want the agent lively."
2. A deploy launches the rocket, "to indicate that we ship new features".

## The owner's answers

| Question                         | Answer                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| How busy                         | Lively: a resting agent rarely stays in its chair.                                                           |
| The time of day                  | Follow the day: lively from 08:00 to 21:00 by the viewing device's clock; at night agents go home as now.    |
| What a deploy is                 | All four kinds offered: a deploy tool, a deploy script or target, a Dokploy redeploy, a deploy workflow run. |
| When the rocket launches         | When the deploy succeeds. A failed deploy gets the failure reaction.                                         |
| The 2D office (the phone's view) | A light version with the places it already draws.                                                            |
| How the 3D side is built         | Upstream's four games back, unchanged, and a schedule of Paseo's own.                                        |

## What was there

- A turn that ends is 9 s of coffee, then the desk, asleep, until work, lunch, the 15:00 coffee, a
  meeting or the night (`people/workers.js` `goHomeAndRest`). The restroom is a 40% roll on the way
  to the desk, at most every 15 minutes each.
- Upstream's pool (`people/billiards.js`), TV matches (`people/gaming.js` with
  `world/props/tv-games.js`), karaoke (`people/karaoke.js` with `people/karaoke-songs.js`) and
  foosball (`people/foosball.js`) are in `DENY` of `import-upstream.mjs`. Their stand-ins do
  nothing, so the table, the TV and the booth are furniture and a click on them does nothing.
  Each game picks resting agents, asleep ones included, and starts on its own now and then
  (a 12 to 20% chance every 30 to 40 s of scene time, between about 09:00 and 22:00, then a pause
  of 10 to 30 minutes). Upstream's midday nap (`life/nap.js`) puts everyone to sleep at their
  desk from 12:30 to 13:30.
- The fish (`feedFish`), the coffee machine (`brewCoffee`) and the arcade (a coin and a toast)
  answer a click only.
- A deploy is a shell command from a fixed list (`server/activity.ts` `DEPLOY`); a push of a
  version tag is one. Tools are placed by a few known names. A push and a deploy launch the rocket
  when they are first seen (`paseo-entry.js` `onEvent`).
- In the 2D office a resting agent sits at its desk with the screen off, apart from a coffee break
  after a turn (`client/pixel/actors.ts`). Its floor draws a sofa, a coffee corner and plants.

## Decisions

### The day of a resting agent (3D)

| Question              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daytime               | 08:00 to 21:00 by the clock the scene reads (`officeNow`, the viewing device's).                                                                                                                                                                                                                                                                                                                                                                                                  |
| The gap               | A resting agent sits at its desk for a gap of 30 to 90 s, its own random length, then gets up for an activity. Its coffee after a turn comes first, as now.                                                                                                                                                                                                                                                                                                                       |
| The activities        | With a second free agent: a game (pool, foosball, or a TV match). Karaoke, alone or with one other. Alone: a nap on a sofa seat (3 to 6 minutes, when the TV is not using the seats), feeding the fish, the arcade (1 to 3 minutes), a cup brewed at the coffee machine and drunk at a dining table (2 to 4 minutes), the restroom.                                                                                                                                               |
| Choosing              | Among what is possible now, at random, never the agent's last activity. One agent at a time at the fish, at the arcade, in each restroom stall; one game at a time at each table and at the TV.                                                                                                                                                                                                                                                                                   |
| A long idle           | After two hours of resting the gap is 10 to 20 minutes, asleep at the desk.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Night                 | After 21:00 an agent that has rested 30 minutes goes home by the lift, as upstream has it, and comes back for work or at 08:00. The rest counts from the host's last change of the agent, its turn's end at the earliest, or from when the 3D view saw it begin if that is earlier (the session's `doneAt`). Only an idle agent carries the host's time: a running one's moves with every step and would send the office an update each time. No activity starts outside daytime. |
| Work                  | An agent that gets a prompt or waits for the user leaves its activity at once and walks to its desk. From the restroom, upstream's own visit included, it goes straight to the work. Upstream's games already end that way.                                                                                                                                                                                                                                                       |
| The stand-up bell     | Before the bell rings (the Stand-up card's `meet()`, a click on the bell), an agent in a solo activity stops where it stands, so the gathering takes it along. A player in a game finishes the game first, as upstream's games do, and misses that stand-up. No activity starts while a gathering is on (`gatheringNow()`).                                                                                                                                                       |
| Reduced motion        | No activity starts, as upstream's games already do.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Upstream's own starts | The games keep their own occasional starts. Upstream's midday nap stays out: it would put the whole floor to sleep.                                                                                                                                                                                                                                                                                                                                                               |

### How the 3D side is built

| Question            | Decision                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream's games    | `import-upstream.mjs` stops denying `people/billiards.js`, `people/gaming.js`, `people/karaoke.js` and `people/foosball.js`. The tool copies them unchanged with what they import (`world/props/tv-games.js`, `people/karaoke-songs.js`), and `MANIFEST.json` records their checksums.                                                                     |
| What they call      | The group chat, the sound and the first-person walk stay out. Their stand-ins gain the exports the games import, and do nothing: no chat, no sound, no first-person play.                                                                                                                                                                                  |
| The schedule        | A new file of Paseo's, `paseo-leisure.js`, beside `paseo-entry.js`. It runs every frame from the stand-in of `life/nap.js`, whose `updateNap` the scene's loop already calls. No upstream file changes.                                                                                                                                                    |
| Its parts           | The decisions (who goes where, when) are a part with no three.js import, so a test runs it without a browser, as `paseo-sign.js`. The rest moves the people.                                                                                                                                                                                               |
| Starting a game     | Through the game's own starter (`billiards()`, `tvMatch()`, `foosball()`, `karaoke()`), forced inside Paseo's daytime so each game's own hours do not apply. A starter that declines (a table busy, too few free) is a game not started.                                                                                                                   |
| The solo activities | Upstream's moves: `errand()` (walk to a spot, hold a pose, come back) with the sleep pose on a sofa seat, the console pose at the arcade, the coffee pose at the machine and at a dining chair; `feedFish()` at the aquarium; `visitWc()` for the restroom. The spots in front of the aquarium and the arcade are worked out from where those props stand. |
| The bell            | `meet()` (Paseo's) and the bell prop's action, wrapped by the entry, stop the solo activities in place before `ringBell`.                                                                                                                                                                                                                                  |
| Lines               | A solo activity has one short English line in its bubble ("Feeding the fish", "Quick nap"), with no emoji. The games use upstream's English lines, already in the English locale.                                                                                                                                                                          |
| Clicks              | A click on the pool table, the TV or the karaoke booth calls free agents over, as upstream's own handlers do.                                                                                                                                                                                                                                              |
| Size                | The scene's script grows by about 80 KB; the build test's bound (1.2 MB) holds.                                                                                                                                                                                                                                                                            |

### The rocket

| Question                  | Decision                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A deploy tool             | A tool whose own name starts with `deploy`, `release`, `publish` or `rollout`, followed by the end of the name, `_` or `-`. For an MCP tool the own name is the part after the server's name: `mcp__flavours-observability__deploy_service` is `deploy_service`.                                                                                                 |
| A deploy script or target | A shell command that runs a script whose file name starts with `deploy` (`scripts/deploy.sh pos …`, `./deploy-prod.mjs`), or `make deploy` / `just deploy` and their `deploy-…` targets.                                                                                                                                                                         |
| A Dokploy redeploy        | A command that calls `compose.deploy`, `compose.redeploy`, `application.deploy` or `application.redeploy` of a Dokploy API.                                                                                                                                                                                                                                      |
| A deploy workflow run     | `gh workflow run` of a workflow whose name has `deploy` or `release` in it.                                                                                                                                                                                                                                                                                      |
| A check or a dry run      | A command, not a deploy: `--check`, `--dry-run` or `--list` on any of the above, and `-n` to make, just or a deploy script (to kubectl and helm it names a namespace). Each command of a line counts on its own: `make -n deploy && make deploy` is a deploy.                                                                                                    |
| The existing list         | Stays: a push of a version tag, `npm run deploy`, the hosting tools, `kubectl apply`, `helm upgrade`, `terraform apply`, `docker push`, `gh release create`.                                                                                                                                                                                                     |
| What leaves the host      | As before: the kind, the call's id and its result. Never the command or the arguments.                                                                                                                                                                                                                                                                           |
| The start                 | The agent walks to the server room and works at the console, as for a command.                                                                                                                                                                                                                                                                                   |
| The end                   | A deploy that succeeds launches the rocket, the desks nearby applaud, also right after a push (upstream applauds a person once in ten minutes), and the agent celebrates in the server room. One that fails gets the failure reaction (the sweat; a second failure within two minutes, the fist on the desk). One cancelled, or never seen to end, does nothing. |
| Finding the end           | As a test run's: the host reports the result when the call ends, and looks the call up again in the timeline's tail when the agent has moved on (`server/activity.ts` `nextStep`).                                                                                                                                                                               |
| A push                    | A plain `git push` keeps the applause and no longer launches the rocket. A push of a version tag is a deploy.                                                                                                                                                                                                                                                    |
| The launch pad's card     | Counts the deploys that succeeded.                                                                                                                                                                                                                                                                                                                               |
| A step between two reads  | The host still reads every 5 s. A read reports the newest tool call made since the read before, also when the agent has gone back to writing: once, by the call's id, and of several the newest. A prompt after it is a new turn and no step. An office just opened reports no old call.                                                                         |

### Sub-agents

| Question          | Decision                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who is busy       | An agent whose own turn has ended (idle, no question open) is busy while an agent it started, or one those started, is running, starting or waiting for the user. Only agents the office shows count.                       |
| Where the rule is | One place, `waitingOnOf` in `client/model.ts`, computed once from the office's agents; every consumer reads its answer.                                                                                                     |
| 3D                | The busy agent is at work for the scene: it walks to its desk and waits there under "Waiting on N sub-agents" (the `subwait` event). No lounge, no desk sleep, no game. The whiteboard's row says the same.                 |
| Its turn          | No prompt is carried to an agent that turns busy. When its last sub-agent ends it rests, and the turn is reported as at any turn's end. If it runs again from the wait, that is a turn and its prompt is carried.           |
| 2D                | At its desk with the screen on and the sub-agent icon; no part in the lounge rotation.                                                                                                                                      |
| Elsewhere         | The stand-up does not ask it and says "Waiting on N sub-agents"; the Library and Review cards do not offer it; the janitor does not reset its context.                                                                      |
| Not covered       | The office's server does not know the rule: a mention on a board still wakes such an agent, and the Host card can still close it. Claude Code's own sub-agents keep their parent running already; nothing changes for them. |

### The 2D office

| Question         | Decision                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daytime          | The same 08:00 to 21:00, by the device's clock.                                                                                                                                                                            |
| The places       | The places the 2D floor already draws: the sofa (a nap), the coffee corner, a plant. Between them the desk with the screen off. No new art: each place uses a pose the 2D office has.                                      |
| The schedule     | Worked out from the agent's id and the time, so every device shows the same floor and a test can check the rule. A turn of about 3 minutes; no two agents on one spot; no agent in the same place two turns running.       |
| A long idle      | After two hours of resting an agent mostly stays at its desk. The 2D office keeps when each agent came to rest, as it keeps the coffee breaks.                                                                             |
| What comes first | A coffee break after a turn, a stand-up at the whiteboard, and every place an agent at work goes to (library, server room, desk).                                                                                          |
| Reduced motion   | Nobody walks, as for the stand-up.                                                                                                                                                                                         |
| Night            | Everyone resting stays at the desk.                                                                                                                                                                                        |
| The rocket       | As in 3D. An agent stands at the pad, where the 2D rocket flies, only when its deploy succeeded. A running deploy works at the racks, a failed one stays there with the failure icon, and a push is shipped from the desk. |

## Components

- `plugins/office/vendor/my-office/import-upstream.mjs`: the four games out of `DENY`. Then the
  tool's run copies them, `world/props/tv-games.js`, `people/karaoke-songs.js`, regenerates
  `paseo-modules.js` and `MANIFEST.json`.
- The stand-ins of `ui/group-chat.js`, `audio/sfx.js`, `interact/first-person.js`: the exports the
  games import. `life/nap.js` (stand-in): calls the schedule each frame.
- `src/office/paseo-leisure.js` (new, Paseo's): the schedule and the solo activities; its pure
  part is tested from vitest. `src/office/paseo-entry.js`: the bell wrapped; a push without the
  rocket; `deploy` and `fail` as the ends of a deploy. `import-upstream.mjs` lists the new file as
  Paseo's (`OWN`).
- `src/i18n/index.js` (stand-in): the solo activities' lines.
- `plugins/office/server/activity.ts`: the four new kinds of deploy; a deploy's result reported as
  a test run's.
- `plugins/office/client/world/adapter.ts`: a deploy that starts is a command; one that ends is
  `deploy` or `fail`.
- `plugins/office/client/pixel/actors.ts` and the 2D office's state: the rotation and the time an
  agent came to rest.
- `plugins/office/vendor/SOURCES.md`, `docs/plugins.md`: what is taken now and what the office does.

## Errors

- An activity whose spot is taken or cannot be reached is not started; the agent picks again at its
  next gap.
- An agent that leaves the office during an activity is dropped from the schedule.
- A game that throws is reported by the scene's guard, and the 3D view gives way to the 2D one with
  "Try 3D again", as for any failure of the scene.

## Testing

- Unit, the host: each new kind of deploy, and commands and tools that are not deploys (a `git
push` of a branch, `make build`, a tool named `get_deploy_status`); a deploy's success and
  failure through the look-back.
- Unit, the adapter: a deploy's start as a command, its success as `deploy`, its failure as `fail`,
  its cancellation as nothing; a push without the rocket.
- Unit, Paseo's own scene code with upstream's modules stood in (`client/world/entry.test.ts`,
  `client/world/leisure-scene.test.ts`): a deploy applauded after a push, the last event kept
  across lists, work calling someone out of the restroom.
- Unit, the 3D schedule's pure part: daytime, the gaps, the long idle, no repeat, work interrupting,
  no start in a gathering, reduced motion.
- Unit, the 2D rotation (`actors.test.ts`): daytime, no shared spot, no repeat, what comes first,
  reduced motion, night, the long idle.
- Build (`server/world-script.test.ts`): the scene bundles under its bound and carries the games.
- Browser, with no app: the scene in a static page in Paseo's browser, made-up resting agents and
  the clock at 10:00 (agents leaving their desks, each game and each solo activity, a prompt calling
  one back, the rocket after a successful deploy and none after a push, nobody playing at 22:00);
  the 2D office's real component with the same agents.

## Not verified

- A real graphics card: the test browser draws with software at about two frames a second, and the
  scene's clock was run faster to see an activity through.
- The office inside the app, with real agents: the scene and the 2D office were looked at in static
  pages with made-up agents. A real deploy's end, read by the host 5 s apart, is covered by the
  unit tests only.
- The walk home at night: no page and no app showed it. A session carries when its agent came to
  rest, and a new list keeps the last event the scene saw of each person; unit tests cover both
  (`directory.test.ts`, `adapter.test.ts`, `entry.test.ts`), not upstream's `lateRest` reading
  them. A change on the host while an agent rests (a new title, a label) moves the host's time, so
  its rest restarts unless the 3D view saw it begin.
- An agent that waits on real sub-agents: the pages set the wait by hand. The rule, read from the
  agents' parents, is covered by the unit tests; that the directory leaves background agents out
  before the client was not looked at.
- A real web search between two reads: the page sent the step's event by hand, and the host's
  side is covered by the unit tests only.
- The installed app on a phone.
- The rocket in the air and the foosball table in a still: the launch was seen as the flag, the
  "Shipped a new version" line and the celebration at the console, and foosball as its players'
  lines, but no screenshot caught the rocket or the players at the table.
- The agents' return to their desks after the bell: two agents stopped at a coffee and a sofa
  stood still when the bell rang, and the gathering ended, but they were next seen in the
  restroom, not at their desks. The stopped agents do walk back to their desks (`errandBack` to
  the home spot); upstream's `goHomeAndRest` then rolls its 40% restroom visit, as after any
  meeting or turn.
- A forced karaoke start that named a singer but started no song. Each game's `who()` takes
  `free(w) || asleep(w)`, and `free` rejects only a priority `want`, so an agent that just ended
  its turn (its report to the director queued) is taken, and the game's own `called()` ends it on
  the next frame. It is upstream's and harmless: the due agent is asked again the next second.
- Work calling an agent out of the restroom (Paseo's visit or upstream's own) and a deploy
  applauded right after a push: unit tests with upstream's moves and applause stood in, not seen
  in the scene.
- Neither a test nor browser evidence: the 2D rocket for a successful deploy, the bell during a
  game, an agent leaving mid-activity.

## Not built

- New 2D art for the pool table, the TV, foosball, the arcade or the aquarium.
- Sound, the group chat and first-person play in the games.
- A switch to turn the lively floor off.
- Upstream's midday nap.
