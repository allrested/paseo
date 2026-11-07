import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { defaultPatterns, gbToBytes } from "../../shared/settings.js";
import { classifyCommand, type PatternRule } from "./classify.js";

interface Case {
  name: string;
  invokedAs: string;
  args: string[];
  expected: number | null;
}

const DEFAULT_RULES: PatternRule[] = defaultPatterns().map((pattern) => ({
  words: pattern.command.split(" "),
  estimateBytes: gbToBytes(pattern.estimateGb),
}));

const GB3 = gbToBytes(3);
const GB2 = gbToBytes(2);
const GB1_5 = gbToBytes(1.5);

// gate.mjs runs a copy rebuilt from source text, so every case also runs against such a copy.
// A reference to anything outside the function body throws a ReferenceError in this copy.
const serialized: typeof classifyCommand = runInNewContext(`(${classifyCommand.toString()})`);

function command(line: string, expected: number | null): Case {
  const [invokedAs, ...args] = line.split(" ");
  return { name: line, invokedAs, args, expected };
}

function rule(words: string, estimateBytes: number): PatternRule {
  return { words: words.split(" "), estimateBytes };
}

const CASES: Case[] = [
  command("npm run typecheck", GB3),
  command("npm run-script typecheck", GB3),
  command("npm --workspace=@getpaseo/server run typecheck", GB3),
  command("npm run typecheck --workspace @getpaseo/server -- --singleThreaded", GB3),
  command("npm -w @getpaseo/server run typecheck", GB3),
  command("npm test", GB2),
  command("npm t", GB2),
  command("npm run test -- --run", GB2),
  command("npm install", GB1_5),
  command("npm i -D zod", GB1_5),
  command("npm ci", GB1_5),
  command("npm clean-install", GB1_5),
  command("npm exec tsc", GB3),
  command("npm x -- vitest run", GB2),
  command("npm run lint", null),
  command("npm run", null),
  command("npm --version", null),
  command("npm", null),
  command("npx tsc --noEmit", GB3),
  command("npx -p typescript tsc", GB3),
  command("npx --package=typescript tsc", GB3),
  command("npx -y vitest@4.1.6 run", GB2),
  command("npx -- jest --ci", GB2),
  command("npx expo export --platform web", GB3),
  command("npx expo start", null),
  command("npx prettier --check .", null),
  command("npx", null),
  command("pnpm typecheck", GB3),
  command("pnpm run typecheck", GB3),
  command("pnpm -r run typecheck", GB3),
  command("pnpm --filter app typecheck", GB3),
  command("pnpm test", GB2),
  command("pnpm install --frozen-lockfile", GB1_5),
  command("pnpm add zod", GB1_5),
  command("pnpm exec tsc", GB3),
  command("pnpm dlx vitest@4 run", GB2),
  command("pnpm list", null),
  command("pnpm lint", null),
  command("tsc --noEmit -p tsconfig.json", GB3),
  command("tsgo --singleThreaded", GB3),
  command("vitest run src/a.test.ts", GB2),
  command("jest --ci", GB2),
  command("gradle build", GB2),
  command("gradlew assemble", GB2),
  command("pytest -x", null),
  command("tsc --version", null),
  command("npx tsc --version", null),
  command("vitest --help", null),
  command("npm test --help", null),
  command("npm test -- --help", GB2),
  command("tsc -v", GB3),
];

describe.each([
  ["the module", classifyCommand],
  ["a copy rebuilt from its source text", serialized],
])("classifyCommand, %s", (_label, classify) => {
  it.each(CASES)("$name", ({ invokedAs, args, expected }) => {
    expect(classify(invokedAs, args, DEFAULT_RULES)).toBe(expected);
  });

  it("picks the longest matching pattern", () => {
    const rules = [rule("npm", 1), rule("npm run typecheck", 3), rule("npm run", 2)];
    expect(classify("npm", ["run", "typecheck"], rules)).toBe(3);
  });

  it("picks the earlier of two equally long matches", () => {
    expect(classify("tsc", [], [rule("tsc", 1), rule("tsc", 2)])).toBe(1);
  });

  it("gates pytest once a pattern names it", () => {
    expect(classify("pytest", ["-x"], [rule("pytest", 5)])).toBe(5);
  });

  it("never matches a pattern with no words", () => {
    expect(classify("tsc", [], [{ words: [], estimateBytes: 1 }])).toBeNull();
  });
});
