import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { config } from './config';
import { connectDB } from './services/database';
import { SearchService } from './services/search';
import { logger } from './utils/logger';
import { createHealthHandler, startStandaloneHealthServer } from './utils/health';

// Middleware
import { userTracker } from './middleware/userTracker';
import { rateLimiter } from './middleware/rateLimiter';
import { adminOnly } from './middleware/admin';
import { errorHandler } from './middleware/errorHandler';

// Commands
import { startCommand, helpCommand, aboutCommand, pingCommand } from './commands/basic';
import { topCommand, featuredCommand } from './commands/discovery';
import { searchCommand } from './commands/search';
import { helpAdminCommand, setCommand, dbCommand, usersCommand } from './commands/admin';
import { broadcastCommand } from './commands/broadcast';

// Handlers
import { channelPostHandler, editedChannelPostHandler } from './handlers/channel';
import { registerCallbackHandlers } from './handlers/callbacks';
import { registerTextHandler } from './handlers/text';

const bot = new Telegraf(config.BOT_TOKEN);
export let searchService: SearchService;

async function main(): Promise<void> {
  await connectDB();
  searchService = new SearchService(bot);

  // ── Middleware ──────────────────────────────────────────────────────────
  bot.use(userTracker());
  bot.use(rateLimiter());

  // ── User commands ───────────────────────────────────────────────────────
  bot.command('start', startCommand);
  bot.command('help', helpCommand);
  bot.command('about', aboutCommand);
  bot.command('ping', pingCommand);
  bot.command('top', topCommand);
  bot.command('featured', featuredCommand);
  bot.command('search', searchCommand);

  // ── Admin commands ──────────────────────────────────────────────────────
  bot.command('helpa', adminOnly(), helpAdminCommand);
  bot.command('set', adminOnly(), setCommand);
  bot.command('db', adminOnly(), dbCommand);
  bot.command('users', adminOnly(), usersCommand);
  bot.command('broadcast', adminOnly(), broadcastCommand);

  // ── Channel indexing ────────────────────────────────────────────────────
  bot.on('channel_post', channelPostHandler);
  bot.on('edited_channel_post', editedChannelPostHandler);

  // ── Callback queries & text flows ───────────────────────────────────────
  registerCallbackHandlers(bot, searchService);
  registerTextHandler(bot, searchService);

  // ── Error handler ───────────────────────────────────────────────────────
  bot.catch(errorHandler);

  // ── Launch ──────────────────────────────────────────────────────────────
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const WEBHOOK_DOMAIN = process.env.RENDER_EXTERNAL_URL;

  if (config.NODE_ENV === 'production' && WEBHOOK_DOMAIN) {
    /**
     * Webhook mode (Render production).
     *
     * Telegraf's bot.launch({ webhook }) creates the HTTP server internally
     * and binds to PORT. We must NOT start a separate server on the same port.
     *
     * Instead we pass a `beforeResponse` hook so the /health route is served
     * by the same server Telegraf owns.
     */
    const webhookPath = `/webhook/${config.BOT_TOKEN}`;
    const healthHandler = createHealthHandler();

    await bot.launch({
      webhook: {
        domain: WEBHOOK_DOMAIN,
        path: webhookPath,
        port: PORT,
        // Telegraf calls this before processing the update, letting us
        // intercept non-webhook requests (health checks, root pings).
        cb: (req, res) => {
          if (req.url === '/health' || req.url === '/') {
            healthHandler(req, res);
            return true; // tells Telegraf we handled it
          }
          return false; // let Telegraf process as webhook update
        },
      },
    });

    logger.info(`🚀 Bot launched via webhook on port ${PORT}`);
    logger.info(`🌐 Webhook URL: ${WEBHOOK_DOMAIN}${webhookPath}`);
    logger.info(`🏥 Health endpoint: ${WEBHOOK_DOMAIN}/health`);
  } else {
    /**
     * Polling mode (local dev, or Render without RENDER_EXTERNAL_URL).
     *
     * Start a standalone health server first (Render needs something on PORT
     * even in polling mode), then launch long-polling.
     */
    startStandaloneHealthServer(PORT);
    await bot.launch();
    logger.info(`🚀 Bot launched in polling mode (${config.NODE_ENV})`);
    logger.info(`🏥 Health server on port ${PORT}`);
  }

  logger.info(`✅ ROM Finder Bot running. Admins: ${config.ADMIN_IDS.join(', ')}`);

  process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
