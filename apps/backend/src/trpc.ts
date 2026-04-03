import { initTRPC } from '@trpc/server';
import { z } from 'zod';

export const t = initTRPC.create();
export const publicProcedure = t.procedure;
export const router = t.router;
