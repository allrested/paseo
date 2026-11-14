// The Stack tab's card summaries. Like the other cards: a status in words, a short note when there
// is something to do, and plain meters (no bars: none of these is a share of a whole).
import type { Probe, StackReading } from "../shared/stack.js";
import type { CardStatus, CardSummary, Meter } from "./cards.js";
import { formatDuration } from "./format.js";

const LABELS: Record<CardStatus, string> = {
  ok: "OK",
  warning: "Warning",
  critical: "Critical",
  error: "Error",
  waiting: "Off",
};

function meter(key: string, label: string, value: string): Meter {
  return { key, label, value, fraction: null, level: "ok" };
}

function summary(status: CardStatus, note: string | null, meters: Meter[]): CardSummary {
  return { status, label: LABELS[status], note, meters };
}

function off(what: string): CardSummary {
  return summary("waiting", `${what} is not set on this host`, []);
}

function probeText(probe: Probe): string {
  return probe.ok ? `Up · ${probe.ms ?? 0} ms` : "Down";
}

export function paseoSummary(reading: StackReading): CardSummary {
  const { version, uptimeSeconds } = reading.paseo;
  const meters = [
    meter("version", "Version", version ?? "Not available"),
    meter("uptime", "Up for", formatDuration(uptimeSeconds * 1000)),
  ];
  const { deploy } = reading;
  if (
    deploy.status === "on" &&
    deploy.tag !== null &&
    version !== null &&
    deploy.tag !== `v${version}`
  ) {
    return summary(
      "warning",
      `The newest tag is ${deploy.tag}; this instance runs ${version}`,
      meters,
    );
  }
  return summary("ok", null, meters);
}

export function figcraftSummary(reading: StackReading): CardSummary {
  const { figcraft } = reading;
  if (figcraft.status === "off") return off("FIGCRAFT_URL");
  const meters = [
    meter("server", "Server", probeText(figcraft.server)),
    meter("web", "Web app", figcraft.web === null ? "Not set" : probeText(figcraft.web)),
    meter("key", "Key file", figcraft.keyFile === "present" ? "Present" : figcraft.keyFile),
  ];
  if (!figcraft.server.ok) {
    return summary(
      "critical",
      `The FigCraft server does not answer: ${figcraft.server.error}`,
      meters,
    );
  }
  if (figcraft.web !== null && !figcraft.web.ok) {
    return summary(
      "warning",
      `The FigCraft web app does not answer: ${figcraft.web.error}`,
      meters,
    );
  }
  if (figcraft.keyFile !== "present") {
    return summary(
      "warning",
      `The server key file is ${figcraft.keyFile}: design mode is off`,
      meters,
    );
  }
  return summary("ok", null, meters);
}

export function androidSummary(reading: StackReading): CardSummary {
  const { android } = reading;
  if (android.status === "off") return off("PASEO_ANDROID_ADB");
  const meters = [
    meter("state", "State", android.state ?? "No answer"),
    meter("version", "Android", android.androidVersion ?? "Not available"),
    meter("maestro", "Maestro", android.maestro ? "On PATH" : "Not installed"),
  ];
  if (android.error !== null) {
    return summary("critical", `The device does not answer: ${android.error}`, meters);
  }
  if (android.state !== "device") {
    return summary("critical", `The device is ${android.state}`, meters);
  }
  if (!android.maestro) return summary("warning", "maestro is not on PATH: no panel flows", meters);
  return summary("ok", null, meters);
}

// GitHub's run and job states, in words.
const RUN_WORDS: Record<string, string> = {
  success: "Passed",
  failure: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  skipped: "Skipped",
  in_progress: "Running",
  queued: "Queued",
  waiting: "Waiting",
};

function runText(value: string | null, none: string): string {
  if (value === null) return none;
  return RUN_WORDS[value] ?? value;
}

export function deploySummary(reading: StackReading): CardSummary {
  const { deploy } = reading;
  if (deploy.status === "off") return off("PASEO_DEPLOY_REPO");
  if (deploy.error !== null) return summary("error", deploy.error, []);
  const meters = [
    meter("tag", "Tag", deploy.tag ?? "None"),
    meter("docker", "Docker", runText(deploy.docker, "None")),
    meter("deploy", "Deploy", runText(deploy.deployJob, "Skipped")),
  ];
  const failed = [deploy.docker, deploy.deployJob].some(
    (value) => value === "failure" || value === "cancelled" || value === "timed_out",
  );
  if (failed) return summary("critical", `The ${deploy.tag} release did not finish`, meters);
  const going = [deploy.docker, deploy.deployJob].some(
    (value) => value === "in_progress" || value === "queued" || value === "waiting",
  );
  if (going) return summary("warning", `The ${deploy.tag} release is still running`, meters);
  return summary("ok", null, meters);
}
