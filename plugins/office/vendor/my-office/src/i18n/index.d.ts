// PASEO: types for index.js, which is Paseo's stand-in and stays as it is.

import type { Translate } from "../shared/chat-engine.js";

export const DEFAULT_LANG: "en";
export const t: Translate;
export function num(n: number, digits?: number): string;
export function lang(): string;
export function locale(): string;
export function createT(): Translate;
