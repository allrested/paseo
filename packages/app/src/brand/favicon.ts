// The tab's icon under a host's own icon. Paseo's favicons come in three drawings, plain,
// running and attention; a host gives one image, so the dot is drawn onto it here.
import type { FaviconStatus } from "@/utils/favicon-status";

const SIZE = 64;
/** The dot's colours, as on Paseo's own favicons. */
const DOT_COLOR: Record<Exclude<FaviconStatus, "none">, string> = {
  running: "#3B82F6",
  attention: "#22C55E",
};

const drawn = new Map<string, Promise<string>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("The brand icon did not load")), {
      once: true,
    });
    image.src = url;
  });
}

async function draw(iconUrl: string, status: Exclude<FaviconStatus, "none">): Promise<string> {
  const image = await loadImage(iconUrl);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return iconUrl;
  context.drawImage(image, 0, 0, SIZE, SIZE);
  // Bottom right, with a clear ring so the dot reads on any icon.
  const radius = SIZE * 0.19;
  const center = SIZE - radius - 1;
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  context.arc(center, center, radius + 3, 0, Math.PI * 2);
  context.fill();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = DOT_COLOR[status];
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL("image/png");
}

/**
 * The address for the tab's icon: the host's icon as it is, or with the status dot drawn on.
 * A browser that cannot draw it keeps the plain icon.
 */
export function brandFaviconHref(iconUrl: string, status: FaviconStatus): Promise<string> {
  if (status === "none" || typeof document === "undefined") return Promise.resolve(iconUrl);
  const key = `${status}\n${iconUrl}`;
  let href = drawn.get(key);
  if (!href) {
    href = draw(iconUrl, status).catch(() => iconUrl);
    drawn.set(key, href);
  }
  return href;
}
