import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import express from "express";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import pino from "pino";

import type { Brand } from "./brand.js";
import { createWebUiMiddleware } from "./web-ui.js";

const logger = pino({ level: "silent" });

interface ResponseSnapshot {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function readResponseBody(res: http.IncomingMessage): Promise<string> {
  let body = "";
  res.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf-8");
  });
  await once(res, "end");
  return body;
}

async function request(
  app: express.Application,
  method: string,
  requestPath: string,
  headers: Record<string, string> = {},
): Promise<ResponseSnapshot> {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Server did not bind to a TCP port");
  }

  try {
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: requestPath,
          method,
          headers: { host: `localhost:${address.port}`, ...headers },
        },
        resolve,
      );
      req.on("error", reject);
      req.end();
    });

    const body = await readResponseBody(res);
    return {
      status: res.statusCode ?? 0,
      headers: res.headers,
      body,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function createApp(options: {
  enabled: boolean;
  distDir: string | null;
  publicDir?: string;
  brand?: Brand | null;
}): express.Application {
  const app = express();
  app.use(
    createWebUiMiddleware({
      enabled: options.enabled,
      distDir: options.distDir,
      label: "test-label",
      logger,
      brand: options.brand,
    }),
  );
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/mcp/agents", (_req, res) => res.json({ mcp: true }));
  if (options.publicDir) {
    app.use("/public", express.static(options.publicDir));
  }
  return app;
}

describe("daemon web UI route module", () => {
  let tempRoot: string;
  let distDir: string;
  let publicDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-web-ui-"));
    distDir = path.join(tempRoot, "dist");
    publicDir = path.join(tempRoot, "public");
    await mkdir(path.join(distDir, "_expo", "static", "js", "web"), { recursive: true });
    await mkdir(publicDir, { recursive: true });

    await writeFile(
      path.join(distDir, "index.html"),
      "<!DOCTYPE html><html><head></head><body>app</body></html>",
    );
    await writeFile(
      path.join(distDir, "_expo", "static", "js", "web", "index-abc123def4567890.js"),
      "console.log('uncompressed');",
    );
    await writeFile(
      path.join(distDir, "_expo", "static", "js", "web", "index-abc123def4567890.js.br"),
      "console.log('brotli');",
    );
    await writeFile(
      path.join(distDir, "_expo", "static", "js", "web", "index-abc123def4567890.js.gz"),
      "console.log('gzip');",
    );
    await writeFile(path.join(distDir, "styles.css"), "body { color: red; }");
    await writeFile(path.join(publicDir, "asset.txt"), "public asset");
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("returns 404 when web UI is disabled", async () => {
    const app = createApp({ enabled: false, distDir, publicDir });

    const res = await request(app, "GET", "/");

    expect(res.status).toBe(404);
    expect(res.body).toBe("");
  });

  test("returns 404 when dist directory is missing", async () => {
    const app = createApp({ enabled: true, distDir: path.join(tempRoot, "missing"), publicDir });

    const res = await request(app, "GET", "/");

    expect(res.status).toBe(404);
  });

  test("serves index.html with injected initial connection hint", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain("window.__PASEO_INITIAL_DAEMON_CONNECTION__");
    expect(res.body).toContain('"listen":"localhost:');
    expect(res.body).toContain('"useTls":false');
    expect(res.body).toContain('"label":"test-label"');
  });

  test("injects hint before closing head tag", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/index.html");

    expect(res.body).toMatch(/window\.__PASEO_INITIAL_DAEMON_CONNECTION__.*<\/head>/);
  });

  test("escapes the injected host hint for inline script safety", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/", {
      host: "evil.test</script><script>alert(1)</script>",
    });

    expect(res.status).toBe(200);
    expect(res.body).toContain("evil.test\\u003C/script\\u003E");
    expect(res.body).not.toContain("evil.test</script>");
  });

  test("falls back to index.html for SPA deep links", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/h/some-server-id/agent/123");

    expect(res.status).toBe(200);
    expect(res.body).toContain("window.__PASEO_INITIAL_DAEMON_CONNECTION__");
    expect(res.body).toContain("app");
  });

  test.each([
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp/agents",
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ])("returns a JSON 404 instead of the SPA for missing %s", async (requestPath) => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", requestPath);

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(res.body)).toEqual({ error: "Not found" });
  });

  test("serves well-known files that exist in the dist directory", async () => {
    await mkdir(path.join(distDir, ".well-known"), { recursive: true });
    await writeFile(path.join(distDir, ".well-known", "security.json"), '{"ok":true}');
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/.well-known/security.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.body).toBe('{"ok":true}');
  });

  test("serves static assets", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/styles.css");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(res.body).toBe("body { color: red; }");
  });

  test("selects brotli precompressed asset when accepted", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/_expo/static/js/web/index-abc123def4567890.js", {
      "accept-encoding": "br, gzip",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["vary"]).toBe("Accept-Encoding");
    expect(res.body).toBe("console.log('brotli');");
  });

  test("selects gzip precompressed asset when brotli is not accepted", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/_expo/static/js/web/index-abc123def4567890.js", {
      "accept-encoding": "gzip",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.body).toBe("console.log('gzip');");
  });

  test("falls back to uncompressed asset when no encoding is accepted", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/_expo/static/js/web/index-abc123def4567890.js");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toBe("console.log('uncompressed');");
  });

  test("does not catch /api/* paths", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  test("does not catch /mcp/* paths", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/mcp/agents");

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"mcp":true}');
  });

  test("does not catch /public/* paths", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/public/asset.txt");

    expect(res.status).toBe(200);
    expect(res.body).toBe("public asset");
  });

  test("sets no-cache headers for index.html", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/");

    expect(res.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
  });

  test("sets immutable caching for hashed assets", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/_expo/static/js/web/index-abc123def4567890.js");

    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("sets no-cache for unhashed static assets", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "GET", "/styles.css");

    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  test("only handles GET and HEAD requests", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });
    app.post("/", (_req, res) => res.json({ posted: true }));

    const res = await request(app, "POST", "/");

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"posted":true}');
  });

  test("responds to HEAD without a body", async () => {
    const app = createApp({ enabled: true, distDir, publicDir });

    const res = await request(app, "HEAD", "/");

    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });
});

describe("daemon web UI under a brand", () => {
  let tempRoot: string;
  let distDir: string;

  const image = (body: string, contentType: string, version: string) => ({
    body: Buffer.from(body),
    contentType,
    etag: `"${version}"`,
    version,
  });
  const BRAND: Brand = {
    name: "Acme <Agents> & Co",
    color: "#112233",
    logo: image("<svg/>", "image/svg+xml", "aaaa000011112222"),
    icon: { ...image("png-bytes", "image/png", "bbbb000011112222"), width: 512, height: 512 },
  };
  const INDEX = [
    "<!doctype html><html><head>",
    '<meta name="theme-color" content="#181B1A" />',
    '<meta name="apple-mobile-web-app-title" content="Paseo" />',
    '<link rel="manifest" href="/manifest.json" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<link rel="icon" href="/favicon.ico"/>',
    "<title>Paseo</title>",
    "</head><body>app</body></html>",
  ].join("");

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-web-ui-brand-"));
    distDir = path.join(tempRoot, "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), INDEX);
    await writeFile(path.join(distDir, "favicon.ico"), "paseo-favicon");
    await writeFile(path.join(distDir, "pwa-icon-512.png"), "paseo-icon");
    await writeFile(
      path.join(distDir, "manifest.json"),
      JSON.stringify({
        name: "Paseo",
        short_name: "Paseo",
        start_url: "/",
        theme_color: "#181B1A",
        background_color: "#181B1A",
        icons: [{ src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" }],
      }),
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const branded = (brand: Brand | null = BRAND) => createApp({ enabled: true, distDir, brand });

  test("the page carries the name, the colour, the icon and what the app reads at start", async () => {
    const res = await request(branded(), "GET", "/h/some/deep/link");

    expect(res.status).toBe(200);
    // The name is text in the page: its markup characters are escaped.
    expect(res.body).toContain("<title>Acme &lt;Agents&gt; &amp; Co</title>");
    expect(res.body).toContain(
      '<meta name="apple-mobile-web-app-title" content="Acme &lt;Agents&gt; &amp; Co" />',
    );
    expect(res.body).toContain('<meta name="theme-color" content="#112233" />');
    expect(res.body).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=bbbb000011112222" />',
    );
    expect(res.body).toContain(
      '<link rel="icon" type="image/png" href="/_brand/icon.png?v=bbbb000011112222" />',
    );
    // In the script the name is JSON, with the characters that could end the script escaped.
    expect(res.body).toContain(
      '<script>window.__PASEO_BRAND__={"name":"Acme \\u003CAgents\\u003E \\u0026 Co","logoUrl":"/_brand/logo?v=aaaa000011112222","iconUrl":"/_brand/icon.png?v=bbbb000011112222"}</script></head>',
    );
    // The build's icon link is replaced, not joined by a second one.
    expect(res.body.match(/rel="icon"/g)).toHaveLength(1);
    expect(res.body).not.toContain("Paseo</title>");
    expect(res.body).toContain("window.__PASEO_INITIAL_DAEMON_CONNECTION__=");
  });

  test("a name with a replacement pattern in it is written as it is", async () => {
    const res = await request(branded({ ...BRAND, name: "Cost $& Co $1" }), "GET", "/");

    expect(res.body).toContain("<title>Cost $&amp; Co $1</title>");
  });

  test("the manifest keeps the build's fields and takes the brand's name, colour and icon", async () => {
    const res = await request(branded(), "GET", "/manifest.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({
      name: "Acme <Agents> & Co",
      short_name: "Acme <Agents> & Co",
      start_url: "/",
      theme_color: "#112233",
      background_color: "#181B1A",
      icons: [
        {
          src: "/_brand/icon.png?v=bbbb000011112222",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
      ],
    });
  });

  test("the logo and every icon path answer with the brand's files, locked down", async () => {
    const app = branded();
    const logo = await request(app, "GET", "/_brand/logo?v=aaaa000011112222");

    expect(logo.status).toBe(200);
    expect(logo.body).toBe("<svg/>");
    expect(logo.headers["content-type"]).toContain("image/svg+xml");
    expect(logo.headers.etag).toBe('"aaaa000011112222"');
    expect(logo.headers["x-content-type-options"]).toBe("nosniff");
    expect(logo.headers["content-security-policy"]).toContain("sandbox");
    for (const iconPath of [
      "/_brand/icon.png",
      "/favicon.ico",
      "/apple-touch-icon.png",
      "/pwa-icon-192.png",
      "/pwa-icon-512.png",
    ]) {
      const icon = await request(app, "GET", iconPath);
      expect([iconPath, icon.status, icon.body, icon.headers["content-type"]]).toEqual([
        iconPath,
        200,
        "png-bytes",
        "image/png",
      ]);
    }
  });

  test("an image the browser already holds is not sent again", async () => {
    const res = await request(branded(), "GET", "/_brand/logo", {
      "if-none-match": '"aaaa000011112222"',
    });

    expect(res.status).toBe(304);
    expect(res.body).toBe("");
  });

  test("a brand with only a name leaves the build's icons and logo alone", async () => {
    const app = branded({ name: "Acme", color: null, logo: null, icon: null });

    const page = await request(app, "GET", "/");
    expect(page.body).toContain("<title>Acme</title>");
    expect(page.body).toContain('<meta name="theme-color" content="#181B1A" />');
    expect(page.body).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(page.body).toContain(
      'window.__PASEO_BRAND__={"name":"Acme","logoUrl":null,"iconUrl":null}',
    );
    expect((await request(app, "GET", "/favicon.ico")).body).toBe("paseo-favicon");
    expect(JSON.parse((await request(app, "GET", "/manifest.json")).body)).toMatchObject({
      name: "Acme",
      theme_color: "#181B1A",
      icons: [{ src: "/pwa-icon-512.png" }],
    });
    // Without a logo the path is the app's to route, like any other.
    expect((await request(app, "GET", "/_brand/logo")).body).toContain("<title>Acme</title>");
  });

  test("without a brand the page and the build's files are as they were", async () => {
    const app = branded(null);

    const page = await request(app, "GET", "/");
    expect(page.body).toContain("<title>Paseo</title>");
    expect(page.body).not.toContain("__PASEO_BRAND__");
    expect(JSON.parse((await request(app, "GET", "/manifest.json")).body).name).toBe("Paseo");
    expect((await request(app, "GET", "/pwa-icon-512.png")).body).toBe("paseo-icon");
  });
});
