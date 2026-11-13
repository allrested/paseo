export const UNREACHABLE = "The Android device is unreachable";

export const TIMED_OUT = "The device did not answer in time";

export class DeviceUnreachableError extends Error {
  constructor() {
    super(UNREACHABLE);
    this.name = "DeviceUnreachableError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
