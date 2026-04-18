import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { config } from './config';
import { connectDB } from './services/database';
import { SearchService } from './services/search';
import { logger } from './utils/logger';
import { createHealthHandler, startStandaloneHealthServer } from './utils/health';

// Middleware
import { userTracker }  from './middleware/userTracker';
import { rateLimiter }  from './middleware/rateLimiter';
import { adminOnly }    from './middleware/admin';
import { errorHandler } from './middleware/errorHandler';

// Commands
import { startCommand, helpCommand, aboutCommand, pingCommand } from './commands/basic';
import { topCommand, featuredCommand }  from './commands/discovery';
import { searchCommand }                from './commands/search';
import { helpAdminCommand, setCommand, dbCommand, usersCommand } from './commands/admin';
import { broadcastCommand }             from './commands/broadcast';
import { backfillCommand } from './commands/backfill';

// Handlers
import { channelPostHandler, editedChannelPostHandler } from './handlers/channel';
import { registerCallbackHandlers } from './handlers/callbacks';
import { registerTextHandler }       from './handlers/text';

const bot = new Telegraf(config.BOT_TOKEN);
export let searchService: SearchService;

async function main(): Promise<void> {
  await connectDB();
  searchService = new SearchService(bot);

  // ── Middleware ─────────────────────────────────────────────────────────
  bot.use(userTracker());
  bot.use(rateLimiter());

  // ── User commands ──────────────────────────────────────────────────────
  bot.command('start',    startCommand);
  bot.command('help',     helpCommand);
  bot.command('about',    aboutCommand);
  bot.command('ping',     pingCommand);
  bot.command('top',      topCommand);
  bot.command('featured', featuredCommand);
  bot.command('search',   searchCommand);

  // ── Admin commands ─────────────────────────────────────────────────────
  bot.command('helpa',     adminOnly(), helpAdminCommand);
  bot.command('set',       adminOnly(), setCommand);
  bot.command('db',        adminOnly(), dbCommand);
  bot.command('users',     adminOnly(), usersCommand);
  bot.command('broadcast', adminOnly(), broadcastCommand);
  bot.command('backfill',  adminOnly(), backfillCommand);

  // ── Channel indexing ───────────────────────────────────────────────────
  bot.on('channel_post',        channelPostHandler);
  bot.on('edited_channel_post', editedChannelPostHandler);

  // ── Callbacks & text ──────────────────────────────────────────────────
  registerCallbackHandlers(bot, searchService);
  registerTextHandler(bot, searchService);


  bot.catch(errorHandler);

  // ── Launch ─────────────────────────────────────────────────────────────
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const WEBHOOK_DOMAIN = process.env.RENDER_EXTERNAL_URL;

  if (config.NODE_ENV === 'production' && WEBHOOK_DOMAIN) {
    const webhookPath = `/webhook/${config.BOT_TOKEN}`;
    const healthHandler = createHealthHandler();

    await bot.launch({
      webhook: {
        domain: WEBHOOK_DOMAIN,
        path: webhookPath,
        port: PORT,
        cb: (req, res) => {
          if (req.url === '/health' || req.url === '/') {
            healthHandler(req, res);
            return true;
          }
          return false;
        },
      },
    });
    logger.info(`🚀 Webhook mode — port ${PORT}, domain ${WEBHOOK_DOMAIN}`);
  } else {
    startStandaloneHealthServer(PORT);
    await bot.launch();
    logger.info(`🚀 Polling mode (${config.NODE_ENV}) — health on port ${PORT}`);
  }

  logger.info(`✅ ROM Finder Bot running. Admins: ${config.ADMIN_IDS.join(', ')}`);

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

main().catch((err) => {
  logger.error('Fatal startup error:', err);
  process.exit(1);
});
