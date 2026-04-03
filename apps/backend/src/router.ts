import { router, publicProcedure } from './trpc';
import { z } from 'zod';
import { dispatchAction } from './action-dispatcher';

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return { status: 'ok' };
  }),
  appInfo: publicProcedure.query(() => {
    return {
      name: 'dashwise-backend',
      runtime: 'bun',
      api: 'trpc',
      timestamp: new Date().toISOString(),
    };
  }),
  echo: publicProcedure
    .input(z.object({ message: z.string() }))
    .mutation(({ input }) => ({ message: input.message })),
  actionCall: publicProcedure
    .input(
      z.object({
        modulePath: z.string(),
        actionName: z.string(),
        args: z.array(z.any()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await dispatchAction(input.modulePath, input.actionName, input.args ?? []);
      return result;
    }),
});

export type AppRouter = typeof appRouter;
