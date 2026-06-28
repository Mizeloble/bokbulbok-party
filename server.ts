import { createServer } from 'node:http';
import { parse } from 'node:url';
import next from 'next';
import { Server as IOServer } from 'socket.io';
import { attachSocketHandlers } from './src/server/socket';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = '0.0.0.0';

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    // Liveness / warmup probe for uptime pings and launch-day checks. Answered
    // here (before Next) so it stays cheap and never touches room state.
    if (parsedUrl.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    return handle(req, res, parsedUrl);
  });

  // No cookie-based auth (tokens travel in socket payloads / sessionStorage), so
  // credentials are unnecessary. In prod set ALLOWED_ORIGIN to the deployed host;
  // unset falls back to `false` (cross-origin denied — same-origin still works) so
  // no deployment URL is baked into the public source. Dev keeps `true` so
  // localhost + LAN QR testing keeps working.
  const allowedOrigin = dev
    ? true
    : process.env.ALLOWED_ORIGIN ?? false;

  const io = new IOServer(httpServer, {
    cors: { origin: allowedOrigin },
    pingInterval: 20_000,
    pingTimeout: 25_000,
    // Every legitimate inbound payload is tiny (roomId, 10-char nickname, 24-char
    // tokens, a single tilt float). The default 1 MB lets a client buffer huge
    // strings before our length checks run — cap it low. (Outbound marble frames
    // are unaffected; this bounds inbound only.)
    maxHttpBufferSize: 8 * 1024,
  });

  attachSocketHandlers(io);

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
