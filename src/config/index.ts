import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  ADMIN_IDS: z.string().transform((val) =>
    val.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id))
  ),
  CHANNELS: z.string().default('').transform((val) =>
    val ? val.split(',').map((id) => id.trim()).filter(Boolean) : []
  ),
  MAX_RESULTS: z.string().default('10').transform(Number),
  CACHE_MAX_SIZE: z.string().default('200').transform(Number),
  CACHE_TTL: z.string().default('3600').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  OWNER_USERNAME: z.string().default('@admin'),
  OWNER_NAME: z.string().default('Bot Admin'),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

export const CATEGORIES = [
  'GBA', 'GBC', 'GB', 'NDS', '3DS', 'PSP', 'PS1',
  'PS2', 'N64', 'SNES', 'NES', 'GCN', 'WII', 'WIIU',
  'SWITCH', 'GENESIS', 'ARCADE', 'OTHER'
] as const;

export type Category = typeof CATEGORIES[number];
