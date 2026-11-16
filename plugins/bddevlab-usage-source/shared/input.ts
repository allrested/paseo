import { z } from "zod";
export const inputSchema = z
  .object({
    /** `env`: a variable of the daemon's own environment. `provider`: a provider entry of the host config, by id. */
    store: z.enum(["env", "provider"]),
    locator: z.string().min(1),
  })
  .strict();
export type UsageInput = z.infer<typeof inputSchema>;
