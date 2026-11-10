// Opcode 0x50 carries one screencast frame of a daemon-hosted browser tab. 0x40–0x4f are diffs.
// Layout: [0x50][version u8][idLength u8][subscriptionId utf8][sequence u32][deviceWidth u16]
// [deviceHeight u16][pageScaleFactor f32][scrollX f32][scrollY f32][jpeg...], big-endian.
export const BROWSER_VIEW_OPCODE = 0x50;
const VERSION = 1;
const METADATA_BYTES = 20;

export interface BrowserViewFrame {
  subscriptionId: string;
  /** Increases by one per frame of a tab; a client drops a frame older than the one it shows. */
  sequence: number;
  /** The page viewport in CSS pixels. Input coordinates are in this space. */
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  scrollX: number;
  scrollY: number;
  jpeg: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeBrowserViewFrame(frame: BrowserViewFrame): Uint8Array {
  const id = encoder.encode(frame.subscriptionId);
  if (id.length > 255) throw new Error("Browser view subscription id is too long");
  const header = 3 + id.length;
  const bytes = new Uint8Array(header + METADATA_BYTES + frame.jpeg.length);
  bytes[0] = BROWSER_VIEW_OPCODE;
  bytes[1] = VERSION;
  bytes[2] = id.length;
  bytes.set(id, 3);
  const view = new DataView(bytes.buffer, bytes.byteOffset + header, METADATA_BYTES);
  view.setUint32(0, frame.sequence >>> 0);
  view.setUint16(4, Math.min(0xffff, Math.max(0, Math.round(frame.deviceWidth))));
  view.setUint16(6, Math.min(0xffff, Math.max(0, Math.round(frame.deviceHeight))));
  view.setFloat32(8, frame.pageScaleFactor);
  view.setFloat32(12, frame.scrollX);
  view.setFloat32(16, frame.scrollY);
  bytes.set(frame.jpeg, header + METADATA_BYTES);
  return bytes;
}

export function decodeBrowserViewFrame(bytes: Uint8Array): BrowserViewFrame | null {
  if (bytes.length < 3 || bytes[0] !== BROWSER_VIEW_OPCODE || bytes[1] !== VERSION) return null;
  const header = 3 + bytes[2];
  if (bytes.length < header + METADATA_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + header, METADATA_BYTES);
  return {
    subscriptionId: decoder.decode(bytes.subarray(3, header)),
    sequence: view.getUint32(0),
    deviceWidth: view.getUint16(4),
    deviceHeight: view.getUint16(6),
    pageScaleFactor: view.getFloat32(8),
    scrollX: view.getFloat32(12),
    scrollY: view.getFloat32(16),
    jpeg: bytes.subarray(header + METADATA_BYTES),
  };
}
