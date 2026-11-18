import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = process.argv[2] ?? "universal";
const architectures = {
  universal: "armeabi-v7a,arm64-v8a,x86,x86_64",
  arm64: "arm64-v8a",
  fork: "arm64-v8a",
}[target];
if (!architectures) {
  throw new Error(`Unknown APK target: ${target}. Use universal, arm64 or fork.`);
}
const isFork = target === "fork";

// The fork's APK is signed with a key that lives outside the repo. Look for it before any build
// step: a build that ends without the key wastes half an hour.
const forkKey = path.join(homedir(), ".paseo-fork/release.keystore");
const forkPassword = path.join(homedir(), ".paseo-fork/release.password");
if (isFork && !(existsSync(forkKey) && existsSync(forkPassword))) {
  console.error(
    `The fork's signing key is missing.\n  keystore: ${forkKey}\n  password: ${forkPassword}\n` +
      'Make it once with keytool (docs/android.md, "The fork\'s app") and keep ~/.paseo-fork/ backed up:\n' +
      "Android installs an update only when it is signed with the same key.",
  );
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(root, "packages/app");
const env = {
  ...process.env,
  APP_VARIANT: isFork ? "fork" : "production",
  PASEO_WATCHDOG_BUILD: "1",
  PASEO_DIAGNOSTIC_BUILD_TIME: new Date().toISOString(),
  PASEO_DIAGNOSTIC_REVISION:
    execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim() +
    (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
      ? "-dirty"
      : ""),
};
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "build:app-deps"], root);
run("npx", ["expo", "prebuild", "--platform", "android", "--no-install"], app);
// Gradle does not track Metro's environment flags. Always regenerate the JS artifact
// so a previous ordinary release cannot silently bypass the profiling renderer.
rmSync(path.join(app, "android/app/build/generated/assets"), { recursive: true, force: true });
run(
  "./gradlew",
  [
    "assembleRelease",
    "--no-daemon",
    "--max-workers=2",
    "-Dorg.gradle.parallel=false",
    `-PreactNativeArchitectures=${architectures}`,
  ],
  path.join(app, "android"),
);
const built = path.join(app, "android/app/build/outputs/apk/release/app-release.apk");
const destination = path.join(
  root,
  isFork ? "artifacts/paseo-fork-arm64.apk" : `artifacts/paseo-dogfood-${target}.apk`,
);
mkdirSync(path.dirname(destination), { recursive: true });
if (isFork) {
  // Gradle signs a release with the debug key. Align the APK, then sign it with the fork's own.
  const sdk =
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), "Android/Sdk");
  const tools = path.join(sdk, "build-tools", "35.0.0");
  const aligned = path.join(path.dirname(built), "app-release-aligned.apk");
  run(path.join(tools, "zipalign"), ["-f", "-P", "16", "4", built, aligned], root);
  run(
    path.join(tools, "apksigner"),
    ["sign", "--ks", forkKey, "--ks-pass", `file:${forkPassword}`, "--out", destination, aligned],
    root,
  );
  console.log(
    `\nFork APK (arm64, signed with ${forkKey}): ${destination}\nLogs: Downloads/Paseo diagnostics\n`,
  );
} else {
  copyFileSync(built, destination);
  console.log(`\nDiagnostic release APK: ${destination}\nLogs: Downloads/Paseo diagnostics\n`);
}
