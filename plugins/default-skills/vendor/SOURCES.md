# Vendored skills

Third-party agent skills that the `default-skills` built-in copies into Claude Code's skills
folder. Each folder below `<skill>/` is installed under its own name. Every installed folder
carries its upstream `LICENSE`. Nothing here is run at vendoring time: no installer, script or
hook from these repositories was executed.

To update a pin, clone the repository into a fresh temporary directory, check out the new commit,
review every changed file, copy the kept files over the folder here, re-apply the edits listed
below, and update this file. The plugin replaces its installed copies at the next daemon start.

## ub-mode

- Repository: https://github.com/unclebob/ub-mode
- Commit: `3da62bf3fcfd2034de41f30d920d2739e566171f`
- Licence: MIT, Copyright (c) 2026 Robert C. Martin (`ub-mode/LICENSE`)
- Kept: `SKILL.md`, `LICENSE`. Left out: `README.md`.
- Edited `SKILL.md`: "Push to the main line at the end" now adds "only when the user or the
  repository's rules allow you to push", so the skill does not override a rule against pushing.
- Not edited: the Crapper, Dryer and Mutator steps name tools from other repositories that are not
  installed. The skill says to use them and does not say to fetch them.

## ai-design-skills

- Repository: https://github.com/elayadesign/ai-design-skills
- Commit: `456d9e0d3e2d84c748bb143c6ca3d90c45e16213`
- Licence: MIT, Copyright (c) 2026 Elaya (`LICENSE` in each folder). `landing-page-design/SKILL.md`
  carries the MIT notice of taste-skill (Copyright (c) 2026 Leonxlnx), which it adapts, in its
  Credits section.
- Kept: `skills/landing-page-design/SKILL.md`, `skills/figma-designer/SKILL.md`.
- Left out: `scripts/validate_skills.py` (validator), `tests/`, `.github/`, `assets/` (banner
  image), `README.md`, `.gitignore`.
- Edited: nothing.

## anti-slop

- Repository: https://github.com/miqdadbadjuber/anti-slop
- Commit: `41b85ede0257f39bfcffedf3f58c3c59bcc8530d` (release 3.2.28, see `antislop/VERSION`)
- Licence: MIT, Copyright (c) 2026 Miqdad Badjuber (`LICENSE` in each folder).
  `antislop-ui/` and `antislop-human/` also ship `LICENSE-web-quality-skills` (MIT, Copyright (c)
  2026 Addy Osmani) for the reference files adapted from web-quality-skills.
- Kept: the six folders under `skills/` (`antislop`, `antislop-code`, `antislop-copywriting`,
  `antislop-human`, `antislop-layoutmobile`, `antislop-ui`), including
  `antislop-human/contrast-check.py`, a local WCAG contrast calculator with no imports beyond
  `os`, `re` and `sys` and no network access.
- Left out: `cli/` (the `npx antislop-ai` installer), `antislop-human/contrast-mcp.py` and
  `.claude-plugin/contrast-mcp-launcher.mjs` (the Python MCP server), every plugin manifest
  (`.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, `.cline-plugin/`, `.kimi-plugin/`,
  `.omp-plugin/`, `.agents/`, `plugin.json`), `rules/` and `antislop.md` (the CLAUDE.md and
  AGENTS.md pointer files), `scripts/`, `assets/`, `.github/`, and the repository docs.
- Edited `antislop/SKILL.md`:
  - The description said "Load always to stop generic AI slop". It now says to load the skill for
    UI, copy or code work, so Claude loads it on demand.
  - The "Already installed, and the user asks how to update" section told the agent to run
    `npx antislop-ai --update`, `npx skills update`, plugin update commands for seven agents, or
    to download the file again. It now says Paseo installs this copy from a pin and tells the
    agent not to run any of them.
  - The saved-mode paragraph told the user to run `npx antislop-ai --mode`. It now says to write
    the settings file and not to run `npx antislop-ai`.
- Not edited: the reference files link to web.dev, w3.org and Chrome documentation as further
  reading. The core's "Three steps run in both modes, whatever else is driving the session" is
  about antislop's own steps beside other skills and does not override the user.

## ui-ux-pro-max

- Repository: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- Commit: `6ae86f61f520d6ca229d2f40e070410638c908c5`
- Licence: MIT, Copyright (c) 2024 Next Level Builder (`ui-ux-pro-max/LICENSE`)
- Kept: `.claude/skills/ui-ux-pro-max/` with `SKILL.md`, `references/`, the CSV data under
  `data/` and `data/stacks/`, and `scripts/search.py`, `core.py`, `design_system.py`,
  `reasoning_contract.py`. The scripts import only the Python standard library and open only the
  data files and, with `--persist`, the output folder the agent names. About 1.3 MB, against
  24 MB for the whole repository.
- Left out:
  - The other six skills in `.claude/skills/` (`banner-design`, `brand`, `design`,
    `design-system`, `slides`, `ui-styling`), the `cli/` installer, `src/`, `stack/` with its
    `.mcp.json` and Claude settings, and the repository scripts and docs. `design` holds the
    Gemini and MuAPI image generation; `ui-styling` and `design-system` tell the agent to run
    `npx shadcn@latest`.
  - `scripts/validate_data.py` and `scripts/tests/`, the maintainers' checks.
  - `data/google-fonts.csv` and `data/google-font-licenses.json`: Google Fonts catalogue metadata
    with popularity ranks, taken from Google Fonts and the google/fonts `METADATA.pb` files, with
    no licence stated for the metadata. The search's `google-fonts` domain returns no results.
  - `data/phosphor-icons-upstream.json` (a copy of the `@phosphor-icons/core` catalogue, which the
    search does not read), `data/data-provenance.json` and `data/catalog-summary.json`
    (maintainers' records, not read by the search).
- Edited `SKILL.md`:
  - Every command ran `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py"`,
    a path that exists only when the repository is installed as a Claude Code plugin. They now run
    `python3 "${CLAUDE_SKILL_DIR}/scripts/search.py"`, with the installed folder named as the
    fallback.
  - "see README for install instructions if Python is missing" now says to report a missing Python
    and use the bundled references instead of installing it.
  - The `google-fonts` row is gone from the domain table, and the auto-detect note says the domain
    has no data in this copy.
- Not edited: `data/stacks/shadcn.csv` and `nuxt-ui.csv` recommend `npx shadcn@latest` and
  `npm create nuxt@latest` as setup guidance for those stacks. They are search results the skill
  tells the agent to treat as recommendations, not as instructions.

## Not vendored

- unslop (https://github.com/heydamir/unslop): the reviewed commit `97daa33` does not exist in the
  repository. Its default branch head is `97daa3e`. Nothing was taken until the pin is confirmed.
- DensePack (https://github.com/Fabian-Galvez/DensePack, commit
  `979a6e0937f7650be5c98f5f648fa993ac64127d`): its SessionStart hook runs `bootstrap.py`, which
  pip-installs Pillow, freetype-py and NumPy from PyPI into the plugin data folder and writes
  `CLAUDE_CODE_THRIFTY_SONIC` into the `env` block of `$CLAUDE_CONFIG_DIR/settings.json` at every
  session start, and on macOS `ensure_python.sh` downloads uv and a Python. Loading it as a plugin
  folder per agent still runs that hook, and Paseo plugins cannot add Claude launch arguments such
  as `--plugin-dir`. No way to switch it on avoids rewriting the user's settings or running its
  installer without patching its scripts, so nothing was vendored.
