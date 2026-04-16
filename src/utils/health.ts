import http from 'http';
import { logger } from '../utils/logger';

/**
 * Minimal HTTP server for Render's health checks.
 * Render pings /health every 30s to keep the service alive.
 */
export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
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
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    logger.info(`🏥 Health server listening on port ${port}`);
  });

  return server;
}
