/**
 * Why a plugin RPC failed, in the handler's own words. The daemon puts "Request failed: " before a
 * handler's message and the client adds the request it failed on after it.
 */
export function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/ requestType=\S+(?: code=\S+)?$/, "").replace(/^Request failed: /, "");
}
