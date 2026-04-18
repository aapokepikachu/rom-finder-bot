import { Context, MiddlewareFn } from 'telegraf';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { isAdmin } from './admin';

/**
 * Maintenance mode middleware.
 *
 * When maintenance is ON:
 *  - All USER commands and messages are blocked with a friendly notice
 *  - ADMIN users pass through completely unaffected
 *  - Channel posts (indexing) pass through so backfill/live-indexing still works
 *
 * The maintenance state is stored in MongoDB so it survives restarts.
 * An in-memory cache avoids a DB hit on every single update.
 */

let cachedMaintenance: boolean | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 10_000; // re-check DB every 10 seconds

export async function isMaintenanceOn(): Promise<boolean> {
  const now = Date.now();
  if (cachedMaintenance !== null && now < cacheExpiry) return cachedMaintenance;

  try {
    const setting = await Setting.findOne({ key: SETTING_KEYS.MAINTENANCE }).lean();
    cachedMaintenance = setting?.value === 'on';
  } catch {
    cachedMaintenance = false;
  }
  cacheExpiry = now + CACHE_TTL;
  return cachedMaintenance;
}

export function invalidateMaintenanceCache(): void {
  cachedMaintenance = null;
  cacheExpiry = 0;
}

export function maintenanceGuard(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    // Channel posts always pass through (needed for live indexing & backfill)
    if (ctx.channelPost || ctx.editedChannelPost) return next();

    // Admins always pass through
    if (isAdmin(ctx.from?.id)) return next();

    const on = await isMaintenanceOn();
    if (!on) return next();

    // Block user — reply once per interaction type
    const notice =
      '🔧 <b>Bot is under maintenance</b>\n\n' +
      'We\'ll be back shortly. Please try again later.';

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🔧 Under maintenance — please wait', { show_alert: true });
    } else if (ctx.message) {
      await ctx.reply(notice, { parse_mode: 'HTML' });
    }
    // Do NOT call next() — request is fully blocked
  };
}
