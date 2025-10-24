import * as dotenv from "dotenv";
dotenv.config();

export const config = {
  PB_URL: process.env.PB_URL!,
  SEARCHITEMS_SCHEDULE: process.env.SEARCHITEMS_SCHEDULE!,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL!,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD!,
  DASHWISE_URL: process.env.DASHWISE_URL
} as const;

export type Config = typeof config;

for (const [key, value] of Object.entries(config)) {
  if (!value) throw new Error(`Missing environment variable: ${key}`);
}
