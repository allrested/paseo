# Branding by environment — design

Date: 2026-11-15. Status: design chosen by the build (program "Orca 1-9, then branding",
sub-project I; the owner asked to run every sub-project and review at the end).

## Problem

A team that hosts the daemon for itself wants the web UI under its own name, logo and icon,
without building the app. The name is in `index.html`, the web manifest, the icons, a logo
component and about fifty translated strings per language.

## Scope

In scope: the web UI the daemon serves, in a browser and installed as a PWA.

- The name: the page title, the installed app's name, and "Paseo" in the app's text.
- The logo: the mark on the welcome, splash, open-project and onboarding screens.
- The icon: favicon, Apple touch icon and the manifest's icons. The favicon keeps its status dot.
- The colour of the browser bar and the installed app's title bar.

Out of scope: the phone apps and the desktop app, which are upstream's builds; the CLI, tool,
environment variable and file names; plugin screens' own wording; a logo per theme; resizing
images.

## Decisions

| Question          | Decision                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it is set   | The daemon's environment: `PASEO_BRAND_NAME`, `PASEO_BRAND_LOGO`, `PASEO_BRAND_ICON`, `PASEO_BRAND_COLOR`. A plugin cannot do it: plugin code loads after the app connects, and no plugin surface owns the title, the icons or the logo.           |
| How it reaches us | The daemon already rewrites `index.html` when it serves it, to add the connection hint. It rewrites the title and meta tags there, adds `window.__PASEO_BRAND__`, and answers the manifest and icon paths itself. The built web UI is not touched. |
| Images            | Paths to files on the daemon's machine, read once at start. The logo is an SVG, PNG, JPEG or WebP; the icon is a PNG, used as it is at every size.                                                                                                 |
| Translated text   | The app replaces the word "Paseo" in a language's strings when it loads them. No string is edited, so the nine languages follow without a translation pass. Lower-case `paseo` (commands, paths, addresses) is left alone.                         |
| Status favicon    | Paseo ships a favicon per status: plain, running, attention. A host gives one icon, so the app draws the dot on it in the browser and keeps the plain icon where it cannot draw.                                                                   |
| Credit            | The Help menu keeps a "Based on Paseo" line when a name is set. Copyright notices and the licence are untouched. Apache-2.0 grants no trademark use, so a host that drops the name is in line; the credit says where the software comes from.      |
| Bad values        | Each variable is checked on its own. A value that fails is logged and ignored, and the rest still apply.                                                                                                                                           |
| Each is optional  | Any one variable works alone: a name without images keeps Paseo's mark, an icon without a name keeps the name.                                                                                                                                     |

## Variables

| Variable            | Value                                                              | Applies to                                                                              |
| ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `PASEO_BRAND_NAME`  | 1 to 40 characters, no control characters                          | `<title>`, the Apple web app title, the manifest's names, the app's translated text     |
| `PASEO_BRAND_LOGO`  | Path to an `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`, up to 1 MiB | The logo on the welcome, splash, open-project and onboarding screens                    |
| `PASEO_BRAND_ICON`  | Path to a `.png`, up to 1 MiB; square, 512 px or more              | Favicon, Apple touch icon, the manifest's icon                                          |
| `PASEO_BRAND_COLOR` | `#RRGGBB`                                                          | `theme-color` and the manifest's `theme_color`: the browser bar and the app's title bar |

A relative path is resolved against `$PASEO_HOME`.

## Components

### Server

- `config.ts` reads the four variables into `webUi.brand`, as raw strings. They join
  `DAEMON_SETTING_ENV_KEYS`, so a desktop-managed daemon does not inherit them.
- `brand.ts` checks them and reads the files: `loadBrand(input, logger)` answers the brand, or
  null when nothing valid is set. It reads a PNG's size from its header for the manifest.
- `web-ui.ts` takes the brand:
  - `index.html`: the title, `apple-mobile-web-app-title`, `theme-color`, an icon link, the Apple
    touch icon link, and `window.__PASEO_BRAND__ = { name, logoUrl, iconUrl }`.
  - `/manifest.json`: the built manifest with the name, colour and icon replaced.
  - `/_brand/logo`, `/_brand/icon.png`, and the built icon paths (`/favicon.ico`,
    `/apple-touch-icon.png`, `/pwa-icon-192.png`, `/pwa-icon-512.png`) answer from memory.
  - Brand images carry an ETag, `nosniff`, and a sandboxing content security policy: an SVG opened
    on its own runs nothing.

### App

- `brand/brand.ts` reads `window.__PASEO_BRAND__` once. Native and desktop builds have none.
- The translation backend passes each language's strings through `brandResources`, which
  replaces the word in every string. A string written in the code goes through `branded()`
  where it is shown: the browser tools warning, the slash command tag, the workspace recovery
  message.
- `brand/favicon.ts` draws the status dot on the brand's icon. `useFaviconStatus` asks it for the
  tab's icon instead of Paseo's three favicons.
- `PaseoLogo` draws the brand's image when there is one. The splash shows it without the shimmer,
  which is cut to the shape of Paseo's mark.
- The Help menu adds "Based on Paseo" under the app's name. Its string takes the product's name
  as a value, so the replacement does not rewrite it.

## Errors and edge cases

- A file that is missing, too large, of another type, or not a PNG where one is needed: a warning
  in the daemon log, and that variable is ignored.
- A PNG that is not square or under 192 px is used, with a warning: a browser may not offer to
  install the app.
- The brand is read at start. A changed file or variable needs a daemon restart.
- A browser that installed the app before the brand was set keeps its old name and icon until it
  is installed again; browsers decide when they read a manifest again.
- A web client served by one daemon and connected to another host shows the serving daemon's brand.

## Testing

- Unit: `loadBrand` on good and bad values; the middleware's `index.html`, manifest and image
  answers with and without a brand, including a name that has to be escaped; `brandResources` on
  nested strings; the translations in English and French under a brand, with the credit line.
- Browser (`favicon.browser.test.ts`): the dot's place, colour and ring on a drawn icon, and the
  plain icon when the image does not load.
- Live, on the dev daemon started with the four variables: the title, the manifest, the icon
  links, the welcome and splash logo, the Help menu and translated settings text, at 1280 and 390.
  The dot was not seen in a tab: no agent runs on the dev daemon.
