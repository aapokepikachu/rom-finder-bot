import http from 'http';
import { logger } from '../utils/logger';

/**
 * Creates a request handler that responds to /health checks.
 * In webhook mode, pass this handler to Telegraf so it can
 * share the same port — no separate server needed.
 * In polling mode, spin up a standalone HTTP server on PORT.
 */
export function createHealthHandler() {
  return (req: http.IncomingMessage, res: http.ServerResponse, next?: () => void) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        })
      );
    } else {
      // Not a health route — let Telegraf handle it (webhook path)
      next?.();
    }
  };
}

/**
 * Standalone health server for polling mode (development / no webhook).
 * Render still needs something on PORT to consider the service healthy.
 */
export function startStandaloneHealthServer(port: number): http.Server {
  const handler = createHealthHandler();
  const server = http.createServer((req, res) => {
    handler(req, res, () => {
      res.writeHead(404);
      res.end('Not found');
    });
  });

  server.listen(port, () => {
    logger.info(`🏥 Health server listening on port ${port}`);
  });

  return server;
}
