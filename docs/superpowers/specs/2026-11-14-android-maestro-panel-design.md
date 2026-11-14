# Maestro flows in the Android panel: design

Approved by the owner on 2026-11-14. It reverses one line of
[the end-to-end testing design](2026-11-13-e2e-testing-design.md#maestro-part-4): Paseo now wraps
Maestro for runs the user starts from the panel. Agents still run `maestro` as a command, and the
two are not coordinated.

## Goal

From the Android workspace panel, the user runs one of the workspace's Maestro flows against the
stack's device, watches it on the device picture, reads the result, and sends a failure to an agent.

## Flows

The panel lists the top-level `.yaml` and `.yml` files of every folder named `.maestro` or
`maestro` up to three levels below the workspace folder, as paths relative to it. Not listed:
`config.yaml` / `config.yml` (Maestro's workspace config), subfolders of those folders (subflows),
and anything under `node_modules` or `.git`.

## Runs

- One run per host at a time: the device is shared. Starting a second answers "A flow is already
  running".
- The run, from the workspace folder:

  ```
  maestro --device <PASEO_ANDROID_ADB> test <flow> --format JUNIT --output <run>/report.xml \
    --debug-output <run>/debug --flatten-debug-output --no-ansi
  ```

- `<run>` is `$PASEO_HOME/android/maestro-runs/<id>/`; only the newest 10 are kept. Nothing is
  written to the repo.
- Stop kills the run; a run is stopped after 15 minutes.
- Passed means exit code 0. A failure's step is the last output line Maestro marks `... FAILED`,
  its message the JUnit report's first `<failure>`, and its picture the newest PNG under
  `<run>/debug`. The step's format is taken from Maestro's plain output and not yet checked on a
  real device.
- A run outlives the panel. The panel subscribes to the host's run state: the current or last run,
  its flow, status, start and end time, failing step, message, and the last 40 output lines.

## Panel

The workspace panel shows a Flows section under the device picture: each flow with Run; while one
runs, its name, the elapsed time and Stop; after it ends, Passed or Failed, the failing step, the
duration, the output (collapsed), and Send to agent. Send to agent picks one of the workspace's
agents and takes an optional note; the agent gets one prompt with the flow, the failing step, the
message and the output tail, and the failure picture as an image. The sidebar screen has no
workspace, so it says "Open Android from a workspace to run its flows".

## Tests

Server: flow discovery on a temporary tree; runs against a fake `maestro` script (pass, fail with a
report and a picture, one at a time, Stop, the time limit, pruning to 10); the prompt Send to agent
builds. Client: the mounted panel test lists flows, starts a run and shows a failure.

No device on the build instance: the manual test runs on the instance with `PASEO_ANDROID_ADB`.
