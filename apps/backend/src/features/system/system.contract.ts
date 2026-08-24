import { z } from "zod";

import { defineGetContract, emptyQuerySchema } from "../../lib/http/contract";

export const appConfigContract = defineGetContract({
  summary: "Get application config",
  tags: ["app"],
  query: emptyQuerySchema,
  response: z.record(z.unknown()),
});

export const appInfoContract = defineGetContract({
  summary: "Get application info",
  tags: ["app"],
  query: emptyQuerySchema,
  response: z.object({
    updateAvailable: z.boolean(),
    currentAppVersion: z.string(),
    userSignupDisabled: z.boolean(),
  }),
});
