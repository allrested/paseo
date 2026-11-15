import { createReadStream, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RequestHandler, Response } from "express";
import type { Logger } from "pino";
import type { Brand, BrandImage } from "./brand.js";

const EXCLUDED_PATH_PREFIXES = ["/api/", "/mcp/", "/public/"];
const EXCLUDED_PATHS = new Set(["/api", "/mcp", "/public"]);

function isExcludedPath(requestPath: string): boolean {
  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (requestPath.startsWith(prefix)) {
      return true;
    }
  }
  return EXCLUDED_PATHS.has(requestPath);
}

// RFC 8615 well-known URIs are machine-read metadata. Clients such as MCP OAuth
// discovery (RFC 9728, RFC 8414) need a 404 for documents the daemon does not
// serve; the SPA's index.html with a 200 reads as malformed metadata.
function isWellKnownPath(requestPath: string): boolean {
  return requestPath === "/.well-known" || requestPath.startsWith("/.well-known/");
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function selectEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  if (!acceptEncoding) {
    return null;
  }
  const normalized = acceptEncoding.toLowerCase();
  if (normalized.includes("br")) {
    return "br";
  }
  if (normalized.includes("gzip")) {
    return "gzip";
  }
  return null;
}

function isHashedAsset(filePath: string): boolean {
  const base = path.basename(filePath);
  // Match content hashes like index-abc123def456.js or main.abc123def456.css.
  return /[-.][0-9a-f]{16,}[-.]/i.test(base);
}

function isInsideDir(targetPath: string, dirPath: string): boolean {
  const resolvedDir = path.resolve(dirPath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedDir || resolvedTarget.startsWith(resolvedDir + path.sep);
}

interface ResolvedTarget {
  resolvedFile: string;
  isIndexHtml: boolean;
}

interface ResolveTargetFileOptions {
  distDir: string;
  requestPath: string;
  spaFallback: boolean;
}

function resolveTargetFile(options: ResolveTargetFileOptions): ResolvedTarget | null {
  const { distDir, requestPath, spaFallback } = options;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(distDir, safePath);

  const stat = safeStat(filePath);
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  const finalStat = safeStat(filePath);
  if (!finalStat?.isFile()) {
    if (!spaFallback) {
      return null;
    }
    filePath = path.join(distDir, "index.html");
    const fallbackStat = safeStat(filePath);
    if (!fallbackStat?.isFile()) {
      return null;
    }
  }

  if (!isInsideDir(filePath, distDir)) {
    return null;
  }

  const resolvedFile = path.resolve(filePath);
  const isIndexHtml = path.basename(resolvedFile).toLowerCase() === "index.html";
  return { resolvedFile, isIndexHtml };
}

function safeStat(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

interface ContentEncodingResult {
  finalFile: string;
  contentEncoding: string | null;
}

function resolveContentEncoding(
  resolvedFile: string,
  acceptEncoding: string | undefined,
): ContentEncodingResult {
  const encoding = selectEncoding(acceptEncoding);
  if (!encoding) {
    return { finalFile: resolvedFile, contentEncoding: null };
  }
  const compressedFile = `${resolvedFile}.${encoding === "br" ? "br" : "gz"}`;
  const compressedStat = safeStat(compressedFile);
  if (compressedStat?.isFile()) {
    return { finalFile: compressedFile, contentEncoding: encoding };
  }
  return { finalFile: resolvedFile, contentEncoding: null };
}

function setResponseCacheHeaders(res: Response, isIndexHtml: boolean, resolvedFile: string): void {
  if (isIndexHtml) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  } else if (isHashedAsset(resolvedFile)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }
}

export interface WebUiMiddlewareOptions {
  enabled: boolean;
  distDir: string | null;
  label: string;
  logger: Logger;
  /** The host's own name, logo, icon and colour in place of Paseo's. */
  brand?: Brand | null;
}

export function createWebUiMiddleware(options: WebUiMiddlewareOptions): RequestHandler {
  const { enabled, distDir, label, logger } = options;
  const brand = options.brand ?? null;
  const childLogger = logger.child({ module: "web-ui" });

  if (!enabled || !distDir) {
    childLogger.info(
      { enabled, hasDistDir: !!distDir },
      "Daemon web UI disabled or missing dist directory",
    );
  } else {
    childLogger.info({ distDir }, "Daemon web UI mounted");
  }

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    if (isExcludedPath(req.path)) {
      next();
      return;
    }

    if (!enabled || !distDir) {
      res.status(404).end();
      return;
    }

    serveWebUiFile({ distDir, requestPath: req.path, label, brand, req, res });
  };
}

interface ServeWebUiFileOptions {
  distDir: string;
  requestPath: string;
  label: string;
  brand: Brand | null;
  req: Parameters<RequestHandler>[0];
  res: Parameters<RequestHandler>[1];
}

/** Where the brand's images are served; the app reads the logo's address from the page. */
const BRAND_LOGO_PATH = "/_brand/logo";
const BRAND_ICON_PATH = "/_brand/icon.png";
/** The built UI's own icon files: with a brand icon, each answers with it. */
const BUILT_ICON_PATHS = new Set([
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
]);

function sendBrandImage(
  image: BrandImage,
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
): void {
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("ETag", image.etag);
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // The file is the host's own, but an SVG opened by its address must still run nothing.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  if (req.headers["if-none-match"] === image.etag) {
    res.status(304).end();
    return;
  }
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  res.status(200).send(image.body);
}

/** The built manifest with the brand's name, colour and icon in place of Paseo's. */
function brandedManifest(distDir: string, brand: Brand): Record<string, unknown> {
  let manifest: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(distDir, "manifest.json"), "utf-8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      manifest = parsed as Record<string, unknown>;
    }
  } catch {
    // A build without a manifest still gets one that names the brand.
  }
  if (brand.name) {
    manifest.name = brand.name;
    manifest.short_name = brand.name;
  }
  if (brand.color) manifest.theme_color = brand.color;
  if (brand.icon) {
    manifest.icons = [
      {
        src: `${BRAND_ICON_PATH}?v=${brand.icon.version}`,
        sizes: `${brand.icon.width}x${brand.icon.height}`,
        type: brand.icon.contentType,
        // Not "maskable": nobody checked that the image keeps clear of the mask's edge.
        purpose: "any",
      },
    ];
  }
  return manifest;
}

/** Answers a path the brand owns. False when the path is not one of them. */
function serveBrandPath(options: ServeWebUiFileOptions & { brand: Brand }): boolean {
  const { brand, distDir, requestPath, req, res } = options;
  if (requestPath === BRAND_LOGO_PATH && brand.logo) {
    sendBrandImage(brand.logo, req, res);
    return true;
  }
  if (brand.icon && (requestPath === BRAND_ICON_PATH || BUILT_ICON_PATHS.has(requestPath))) {
    sendBrandImage(brand.icon, req, res);
    return true;
  }
  if (requestPath === "/manifest.json" && (brand.name || brand.color || brand.icon)) {
    res.setHeader("Content-Type", CONTENT_TYPES[".json"] ?? "application/json");
    res.setHeader("Cache-Control", "no-cache");
    if (req.method === "HEAD") res.status(200).end();
    else res.status(200).send(JSON.stringify(brandedManifest(distDir, brand)));
    return true;
  }
  return false;
}

function serveWebUiFile(options: ServeWebUiFileOptions): void {
  const { distDir, requestPath, label, brand, req, res } = options;
  if (brand && serveBrandPath({ ...options, brand })) return;

  const wellKnown = isWellKnownPath(requestPath);
  const target = resolveTargetFile({ distDir, requestPath, spaFallback: !wellKnown });
  if (!target) {
    if (wellKnown) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(404).end();
    return;
  }

  const { resolvedFile, isIndexHtml } = target;
  const acceptEncoding = isIndexHtml ? undefined : req.headers["accept-encoding"];
  const { finalFile, contentEncoding } = resolveContentEncoding(resolvedFile, acceptEncoding);

  res.setHeader("Content-Type", getContentType(resolvedFile));
  if (contentEncoding) {
    res.setHeader("Content-Encoding", contentEncoding);
    res.setHeader("Vary", "Accept-Encoding");
  }
  setResponseCacheHeaders(res, isIndexHtml, resolvedFile);

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  if (isIndexHtml) {
    sendIndexHtml({ res, filePath: finalFile, req, label, brand });
    return;
  }

  const stream = createReadStream(finalFile);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

interface SendIndexHtmlInput {
  res: Response;
  filePath: string;
  req: Parameters<RequestHandler>[0];
  label: string;
  brand: Brand | null;
}

function sendIndexHtml({ res, filePath, req, label, brand }: SendIndexHtmlInput): void {
  try {
    const html = readFileSync(filePath, "utf-8");
    const hinted = injectConnectionHint(html, req, label);
    res.status(200).send(brand ? injectBrand(hinted, brand) : hinted);
  } catch {
    res.status(500).end();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Adds markup at the end of the head, or in front of a page that has none. */
function appendToHead(html: string, markup: string): string {
  const headClose = /<\/head>/i;
  // A function, so a "$" in the markup is not read as a replacement pattern.
  return headClose.test(html) ? html.replace(headClose, () => `${markup}</head>`) : markup + html;
}

/** Sets a meta tag's content, adding the tag when the page has none. */
function setMeta(html: string, name: string, content: string): string {
  const tag = `<meta name="${name}" content="${escapeHtml(content)}" />`;
  const existing = new RegExp(`<meta\\s+name="${name}"[^>]*>`, "i");
  return existing.test(html) ? html.replace(existing, () => tag) : appendToHead(html, tag);
}

/**
 * The page under the host's own brand: its title, its colour, its icon, and the name and logo
 * address the app reads at start.
 */
export function injectBrand(html: string, brand: Brand): string {
  let page = html;
  if (brand.name) {
    const title = `<title>${escapeHtml(brand.name)}</title>`;
    const existing = /<title>[^<]*<\/title>/i;
    page = existing.test(page) ? page.replace(existing, () => title) : appendToHead(page, title);
    page = setMeta(page, "apple-mobile-web-app-title", brand.name);
  }
  if (brand.color) page = setMeta(page, "theme-color", brand.color);
  if (brand.icon) {
    const version = brand.icon.version;
    const touch = `<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${version}" />`;
    const existing = /<link\s+rel="apple-touch-icon"[^>]*>/i;
    page = existing.test(page) ? page.replace(existing, () => touch) : appendToHead(page, touch);
    const icon = `<link rel="icon" type="${brand.icon.contentType}" href="${BRAND_ICON_PATH}?v=${version}" />`;
    // The build's own icon link goes: two would leave the choice to the browser.
    const builtIcon = /<link\s+rel="icon"[^>]*>/i;
    page = builtIcon.test(page) ? page.replace(builtIcon, () => icon) : appendToHead(page, icon);
  }
  const client = {
    name: brand.name,
    logoUrl: brand.logo ? `${BRAND_LOGO_PATH}?v=${brand.logo.version}` : null,
    iconUrl: brand.icon ? `${BRAND_ICON_PATH}?v=${brand.icon.version}` : null,
  };
  return appendToHead(
    page,
    `<script>window.__PASEO_BRAND__=${serializeInlineScriptJson(client)}</script>`,
  );
}

function serializeInlineScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026");
}

/**
 * A Host header carries no port when the client used the scheme's default one,
 * which is what every browser sends to a proxy terminating TLS on 443. The app
 * parses `listen` with parseHostPort, which requires an explicit port and
 * rejects the value outright, so the hint has to spell the port out.
 */
function hasExplicitPort(host: string): boolean {
  if (host.startsWith("[")) {
    // IPv6 literals are bracketed: [::1] has no port, [::1]:443 does.
    const end = host.indexOf("]");
    return end !== -1 && /^:\d{1,5}$/.test(host.slice(end + 1));
  }
  const colon = host.indexOf(":");
  return colon !== -1 && colon === host.lastIndexOf(":") && /^\d{1,5}$/.test(host.slice(colon + 1));
}

function injectConnectionHint(
  html: string,
  req: Parameters<RequestHandler>[0],
  label: string,
): string {
  const host = typeof req.headers.host === "string" ? req.headers.host : "";
  const useTls = req.protocol === "https";
  let listen = host;
  if (host && !hasExplicitPort(host)) {
    let defaultPort = 80;
    if (useTls) {
      defaultPort = 443;
    }
    listen = `${host}:${defaultPort}`;
  }
  const hint = {
    listen,
    useTls,
    label,
  };
  const script = `<script>window.__PASEO_INITIAL_DAEMON_CONNECTION__=${serializeInlineScriptJson(hint)}</script>`;
  const headClose = /<\/head>/i;
  if (headClose.test(html)) {
    return html.replace(headClose, `${script}</head>`);
  }
  return script + html;
}
