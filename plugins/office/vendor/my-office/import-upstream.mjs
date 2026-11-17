#!/usr/bin/env node
// Copies the part of my-office that the Paseo office draws with, from an upstream checkout.
// Run it only to take a newer upstream; the result is committed. See ../SOURCES.md.
//
//   node import-upstream.mjs --from <my-office checkout> --three <node_modules/three> [--check]
//
// It copies the scene modules reached from upstream's start-up list, minus the parts Paseo does
// not take (DENY), and the three.js files they import. It never writes a stand-in (a file at a
// DENY path) and never overwrites a file that carries a "PASEO:" note; it lists both instead.
// The team chat's engine and its English words go to the plugin's shared/upstream/ instead (CHAT).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const FROM = option("--from");
const THREE = option("--three");
const CHECK = args.includes("--check");
if (!FROM || !THREE) {
  console.error("usage: import-upstream.mjs --from <my-office checkout> --three <node_modules/three> [--check]");
  process.exit(2);
}

/**
 * Not taken: upstream's panels, chat window, replay, demo, every sound but the siren, the street, and the daily-life scenes.
 * The lounge's four games are taken (people/billiards.js, gaming.js, foosball.js, karaoke.js). The siren's
 * audio/sfx.js and life/incidents.js are taken trimmed by hand, so they stay denied here and only their exports are
 * checked.
 */
const DENY = [
  /^office\/ui\/(?!event-text\.js$|icons\.js$|photo\.js$)/,
  /^office\/(demo|replay|audio)\//,
  /^office\/world\/backdrops\//,
  /^office\/world\/pro\/wing\.js$/,
  /^office\/people\/(outings|comnha|comtrua|duty|teatime|accountant|rounds|guard|hr|farewell|interns|nhau|photobooth|pickle|staff)\.js$/,
  /^office\/life\/(seasons|rain|weather|altar|lift-service|drill|day-swaps|photostrips|post|incidents|nap)\.js$/,
  /^office\/main\.js$/,
  /^i18n\/index\.js$/,
  /^i18n\/locales\/(?!en\/)/,
];
/** Written by hand or by this script, never copied from upstream. */
const OWN = new Set([
  "office/paseo-entry.js",
  "office/paseo-host.js",
  "office/paseo-style.js",
  "office/paseo-modules.js",
  "office/paseo-sign.js",
  "office/paseo-focus.js",
  "office/paseo-leisure-plan.js",
  "office/paseo-leisure.js",
]);
const denied = (rel) => DENY.some((re) => re.test(rel));
const srcOf = (rel) => path.join(FROM, "src", rel);
const outOf = (rel) => path.join(HERE, "src", rel);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const posix = (p) => p.split(path.sep).join("/");

const IMPORT = /(\bimport\s+(?:[\w*\s{},$]+?\s+from\s+)?|\bexport\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])([^'"]+)\2/g;
const taken = new Map(); // rel -> upstream text
const needs = new Map(); // denied rel -> Set of names
const addons = new Map(); // "addons/..." -> text

function namesOf(statement) {
  const star = /import\s+\*\s+as\s+\w+/.test(statement);
  if (star) return ["*"];
  const braces = statement.match(/\{([^}]*)\}/);
  const names = braces ? braces[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
  if (/import\s+\w+\s*(,|from)/.test(statement)) names.push("default");
  return names;
}

function visit(rel) {
  if (taken.has(rel) || OWN.has(rel)) return;
  const file = srcOf(rel);
  if (!existsSync(file)) throw new Error(`upstream has no ${rel}`);
  const text = readFileSync(file, "utf8");
  taken.set(rel, text);
  for (const match of text.matchAll(IMPORT)) {
    const spec = match[3];
    if (spec === "three") continue;
    if (spec.startsWith("three/addons/")) { visitAddon(spec.slice("three/".length)); continue; }
    if (!spec.startsWith(".")) throw new Error(`${rel} imports ${spec}: not a file of the checkout or three`);
    const target = posix(path.normalize(path.join(path.dirname(rel), spec)));
    if (denied(target)) {
      if (!needs.has(target)) needs.set(target, new Set());
      for (const name of namesOf(match[0])) needs.get(target).add(name);
    } else visit(target);
  }
}

function visitAddon(rel) {
  if (addons.has(rel)) return;
  const file = path.join(THREE, "examples/jsm", rel.slice("addons/".length));
  if (!existsSync(file)) throw new Error(`three has no ${rel}`);
  const text = readFileSync(file, "utf8");
  addons.set(rel, text);
  for (const match of text.matchAll(IMPORT)) {
    const spec = match[3];
    if (spec === "three") continue;
    if (!spec.startsWith(".")) throw new Error(`${rel} imports ${spec}`);
    visitAddon(posix(path.normalize(path.join(path.dirname(rel), spec))));
  }
}

/** `three` and `three/addons/...` become paths into this folder, so the bundle needs no package. */
function rewrite(text, fromFile) {
  const relativeTo = (target) => {
    const spec = posix(path.relative(path.dirname(fromFile), target));
    return spec.startsWith(".") ? spec : `./${spec}`;
  };
  return text.replace(IMPORT, (whole, head, quote, spec) => {
    if (spec === "three") return `${head}${quote}${relativeTo(path.join(HERE, "three/three.module.min.js"))}${quote}`;
    if (spec.startsWith("three/addons/")) return `${head}${quote}${relativeTo(path.join(HERE, "three", spec.slice("three/".length)))}${quote}`;
    return whole;
  });
}

// Upstream's start-up order, kept modules only.
const main = readFileSync(srcOf("office/main.js"), "utf8");
const imported = new Map();
for (const m of main.matchAll(/^import \* as (\w+) from '\.\/([^']+)';/gm)) imported.set(m[1], `office/${m[2]}`);
const listStart = main.indexOf("const MODULES = [");
const order = main
  .slice(listStart, main.indexOf("];", listStart))
  .split("\n")
  .map((line) => line.trim().replace(/,.*$/, ""))
  .filter((name) => imported.has(name));
const kept = order.filter((name) => !denied(imported.get(name)));
for (const name of kept) visit(imported.get(name));
for (const rel of ["i18n/locales/en/common.js", "i18n/locales/en/time.js"]) visit(rel);

/**
 * The team chat's engine and its English `chat` area, taken unchanged into the plugin's shared/upstream/: the
 * plugin's own bundles take modules only from client/, server/ and shared/ (packages/server/src/server/plugins/
 * compiler-build.ts). The scene does not run the engine.
 */
const CHAT = new Map([
  ["shared/chat-engine.js", "chat-engine.js"],
  ["i18n/locales/en/chat.js", "chat.js"],
]);
const chatOut = (name) => path.join(HERE, "../../shared/upstream", name);
const chatTaken = new Map();
for (const rel of CHAT.keys()) {
  const file = srcOf(rel);
  if (!existsSync(file)) throw new Error(`upstream has no ${rel}`);
  const text = readFileSync(file, "utf8");
  if (text.match(IMPORT)) throw new Error(`${rel} imports another file: take it too`);
  chatTaken.set(rel, text);
}

// The English areas the kept code names: 'people.poke', `events.${type}`.
const areas = readFileSync(srcOf("i18n/locales/en/index.js"), "utf8");
const areaNames = [...areas.matchAll(/^import (\w+) from '\.\/(\w[\w-]*)\.js';/gm)].map((m) => [m[1], m[2]]);
const allText = [...taken.values()].join("\n");
const usedAreas = areaNames.filter(([name]) => name === "common" || name === "time" || new RegExp(`['"\`]${name}\\.[A-Za-z]`).test(allText));
for (const [, file] of usedAreas) visit(`i18n/locales/en/${file}.js`);

const threeVersion = JSON.parse(readFileSync(path.join(THREE, "package.json"), "utf8")).version;
const threeBuild = readFileSync(path.join(THREE, "build/three.module.min.js"));
const commit = execFileSync("git", ["-C", FROM, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const version = JSON.parse(readFileSync(path.join(FROM, "package.json"), "utf8")).version;

const report = { written: 0, same: 0, keptLocal: [], missingStandIns: [] };
function put(file, text) {
  if (existsSync(file)) {
    const current = readFileSync(file, "utf8");
    if (current === text) { report.same += 1; return; }
    if (current.includes("PASEO:")) { report.keptLocal.push(posix(path.relative(HERE, file))); return; }
  }
  report.written += 1;
  if (CHECK) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

for (const [rel, text] of taken) put(outOf(rel), rewrite(text, outOf(rel)));
for (const [rel, text] of addons) put(path.join(HERE, "three", rel), rewrite(text, path.join(HERE, "three", rel)));
for (const [rel, text] of chatTaken) put(chatOut(CHAT.get(rel)), text);
if (!CHECK) {
  mkdirSync(path.join(HERE, "three"), { recursive: true });
  writeFileSync(path.join(HERE, "three/three.module.min.js"), threeBuild);
  for (const name of ["LICENSE"]) {
    writeFileSync(path.join(HERE, name), readFileSync(path.join(FROM, name)));
    writeFileSync(path.join(HERE, "three", name), readFileSync(path.join(THREE, name)));
  }
}

const modules = [
  "// Generated by import-upstream.mjs: upstream's start-up order, kept modules only. Do not edit.",
  ...kept.map((name) => `import * as ${name} from './${imported.get(name).slice("office/".length)}';`),
  "",
  `export const MODULES = [\n${kept.map((name) => `  ['${name}', ${name}],`).join("\n")}\n];`,
  "",
].join("\n");
put(outOf("office/paseo-modules.js"), modules);
put(
  outOf("i18n/locales/en/index.js"),
  [
    "// Generated by import-upstream.mjs: the English areas the kept modules name. Do not edit.",
    ...usedAreas.map(([name, file]) => `import ${name} from './${file}.js';`),
    "",
    `export default { ${usedAreas.map(([name]) => name).join(", ")} };`,
    "",
  ].join("\n"),
);

// Each stand-in must export what the kept modules import from the part it stands for.
for (const [rel, names] of [...needs].sort()) {
  const file = outOf(rel);
  const text = existsSync(file) ? readFileSync(file, "utf8") : null;
  const missing = [...names].filter((name) => {
    if (text === null) return true;
    if (name === "*") return false;
    if (name === "default") return !/export\s+default\b/.test(text);
    return !new RegExp(`export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|class)\\s+${name.replace(/\$/g, "\\$")}\\b|export\\s*\\{[^}]*\\b${name.replace(/\$/g, "\\$")}\\b[^}]*\\}`).test(text);
  });
  if (missing.length > 0) report.missingStandIns.push(`${rel}: ${missing.join(", ")}`);
}

const manifest = {
  upstream: { repository: "https://github.com/khanh020905/my-office", commit, version },
  three: { version: threeVersion, sha256: sha(threeBuild), bytes: threeBuild.length },
  setupOrder: kept.map((name) => imported.get(name)),
  standIns: Object.fromEntries([...needs].sort().map(([rel, names]) => [rel, [...names].sort()])),
  files: Object.fromEntries([...taken].sort().map(([rel, text]) => [rel, sha(text)])),
  addons: Object.fromEntries([...addons].sort().map(([rel, text]) => [rel, sha(text)])),
  // Upstream's path -> its copy in the plugin's shared/upstream/.
  chat: Object.fromEntries([...chatTaken].map(([rel, text]) => [rel, { to: `shared/upstream/${CHAT.get(rel)}`, sha256: sha(text) }])),
};
if (!CHECK) writeFileSync(path.join(HERE, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`upstream ${commit.slice(0, 7)} (v${version}), three ${threeVersion}`);
console.log(`modules in start-up order: ${kept.length}; files: ${taken.size}; three add-ons: ${addons.size}; english areas: ${usedAreas.map(([name]) => name).join(" ")}; chat files: ${chatTaken.size}`);
console.log(`${CHECK ? "would write" : "written"}: ${report.written}, unchanged: ${report.same}`);
if (report.keptLocal.length > 0) console.log(`kept (carry a PASEO: note, upstream differs or changed):\n  ${report.keptLocal.join("\n  ")}`);
if (report.missingStandIns.length > 0) console.log(`stand-ins to write or extend:\n  ${report.missingStandIns.join("\n  ")}`);
