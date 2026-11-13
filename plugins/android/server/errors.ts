export const UNREACHABLE = "The Android device is unreachable";

export class DeviceUnreachableError extends Error {
  constructor() {
    super(UNREACHABLE);
    this.name = "DeviceUnreachableError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
