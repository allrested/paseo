export interface PatternRule {
  /** The command's leading words once options are dropped, such as ["npm", "run", "typecheck"]. */
  words: readonly string[];
  estimateBytes: number;
}

/**
 * The memory estimate, in bytes, of the longest heavy pattern the command matches, or null for a
 * light command.
 *
 * installShims copies this function into gate.mjs with Function.prototype.toString(), so its body
 * may use only its parameters and JavaScript globals: no imports, no module-level constants, no
 * helpers declared outside it. classify.test.ts runs every case against such a copy as well.
 */
export function classifyCommand(
  invokedAs: string,
  args: readonly string[],
  patterns: readonly PatternRule[],
): number | null {
  // npm options that take the next argument as their value unless written --name=value.
  const NPM_VALUE_OPTIONS = [
    "-w",
    "--workspace",
    "--prefix",
    "-C",
    "--loglevel",
    "--userconfig",
    "--cache",
    "--registry",
  ];
  const NPX_VALUE_OPTIONS = ["-p", "--package", "-c", "--call", ...NPM_VALUE_OPTIONS];
  // pnpm's -w is --workspace-root, a flag, so it is not listed.
  const PNPM_VALUE_OPTIONS = [
    "-C",
    "--dir",
    "-F",
    "--filter",
    "--filter-prod",
    "--loglevel",
    "--reporter",
    "--package",
  ];
  const NPM_ALIASES = new Map([
    ["run-script", "run"],
    ["rum", "run"],
    ["urn", "run"],
    ["t", "test"],
    ["tst", "test"],
    ["i", "install"],
    ["in", "install"],
    ["ins", "install"],
    ["inst", "install"],
    ["insta", "install"],
    ["instal", "install"],
    ["isnt", "install"],
    ["isnta", "install"],
    ["isntal", "install"],
    ["isntall", "install"],
    ["add", "install"],
    ["clean-install", "ci"],
    ["ic", "ci"],
    ["install-clean", "ci"],
    ["isntall-clean", "ci"],
    ["x", "exec"],
  ]);
  // pnpm commands that are not scripts. Any other first word runs the package script of that name.
  const PNPM_COMMANDS = new Set([
    "audit",
    "bin",
    "cache",
    "config",
    "create",
    "deploy",
    "doctor",
    "env",
    "fetch",
    "import",
    "init",
    "licenses",
    "link",
    "list",
    "ls",
    "outdated",
    "pack",
    "patch",
    "prune",
    "publish",
    "rebuild",
    "remove",
    "rm",
    "root",
    "server",
    "setup",
    "store",
    "unlink",
    "update",
    "up",
    "why",
  ]);
  // A version or help probe is light for every command. -v and -h are left out: -v means verbose
  // for pytest.
  const PROBE_OPTIONS = new Set(["--version", "--help"]);

  function isOption(token: string): boolean {
    return token.length > 1 && token.startsWith("-");
  }

  // Index of the first positional argument, skipping options and their values; -1 when none.
  function firstPositional(tokens: readonly string[], valueOptions: readonly string[]): number {
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === "--") return index + 1 < tokens.length ? index + 1 : -1;
      if (!isOption(token)) return index;
      index += valueOptions.includes(token) ? 2 : 1;
    }
    return -1;
  }

  // Every positional argument. After "--" the arguments belong to another program, so only the
  // ones that do not look like options count.
  function positionals(tokens: readonly string[], valueOptions: readonly string[]): string[] {
    const words: string[] = [];
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === "--") {
        for (const rest of tokens.slice(index + 1)) {
          if (!isOption(rest)) words.push(rest);
        }
        return words;
      }
      if (isOption(token)) {
        index += valueOptions.includes(token) ? 2 : 1;
      } else {
        words.push(token);
        index += 1;
      }
    }
    return words;
  }

  // npx, npm exec and pnpm exec or dlx: the target command without its @version, then its words.
  function execWords(tokens: readonly string[], valueOptions: readonly string[]): string[] {
    const at = firstPositional(tokens, valueOptions);
    if (at < 0) return [];
    const target = tokens[at];
    const versionAt = target.indexOf("@", 1);
    const name = versionAt > 0 ? target.slice(0, versionAt) : target;
    return [name, ...positionals(tokens.slice(at + 1), [])];
  }

  // `npm run test` is the same command as `npm test`.
  function npmRun(words: readonly string[]): string[] {
    if (words[0] === "test") return ["npm", "test", ...words.slice(1)];
    return ["npm", "run", ...words];
  }

  function npmWords(tokens: readonly string[]): string[] {
    const at = firstPositional(tokens, NPM_VALUE_OPTIONS);
    if (at < 0) return ["npm"];
    const command = NPM_ALIASES.get(tokens[at]) ?? tokens[at];
    const rest = tokens.slice(at + 1);
    if (command === "exec") return execWords(rest, NPX_VALUE_OPTIONS);
    const words = positionals(rest, NPM_VALUE_OPTIONS);
    if (command === "run") return npmRun(words);
    return ["npm", command, ...words];
  }

  function pnpmWords(tokens: readonly string[]): string[] {
    const at = firstPositional(tokens, PNPM_VALUE_OPTIONS);
    if (at < 0) return ["pnpm"];
    const command = tokens[at];
    const rest = tokens.slice(at + 1);
    if (command === "exec" || command === "dlx") return execWords(rest, PNPM_VALUE_OPTIONS);
    const words = positionals(rest, PNPM_VALUE_OPTIONS);
    if (command === "run" || command === "run-script") return npmRun(words);
    if (command === "test" || command === "t") return ["npm", "test", ...words];
    if (command === "install" || command === "i" || command === "add") {
      return ["npm", "install", ...words];
    }
    if (PNPM_COMMANDS.has(command)) return ["pnpm", command, ...words];
    return npmRun([command, ...words]);
  }

  function commandWords(): string[] {
    if (invokedAs === "npm") return npmWords(args);
    if (invokedAs === "npx") return execWords(args, NPX_VALUE_OPTIONS);
    if (invokedAs === "pnpm") return pnpmWords(args);
    return [invokedAs, ...positionals(args, [])];
  }

  function startsWithWords(words: readonly string[], prefix: readonly string[]): boolean {
    if (prefix.length === 0 || prefix.length > words.length) return false;
    return prefix.every((word, index) => words[index] === word);
  }

  // After "--" the arguments belong to another program, such as the script `npm test` runs.
  const separatorAt = args.indexOf("--");
  const ownArgs = separatorAt < 0 ? args : args.slice(0, separatorAt);
  if (ownArgs.some((arg) => PROBE_OPTIONS.has(arg))) return null;

  const words = commandWords();
  let best: PatternRule | null = null;
  for (const pattern of patterns) {
    if (!startsWithWords(words, pattern.words)) continue;
    if (best === null || pattern.words.length > best.words.length) best = pattern;
  }
  return best === null ? null : best.estimateBytes;
}
