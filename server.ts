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
    return handle(req, res, parsedUrl);
  });

  // No cookie-based auth (tokens travel in socket payloads / sessionStorage), so
  // credentials are unnecessary. In prod, restrict the reflected origin to the
  // deployed host to avoid third-party embeds spamming room creation; dev keeps
  // `true` so localhost + LAN QR testing keeps working.
  const allowedOrigin = dev
    ? true
    : process.env.ALLOWED_ORIGIN ?? 'https://ax-lunch-coffee.fly.dev';

  const io = new IOServer(httpServer, {
    cors: { origin: allowedOrigin },
    pingInterval: 20_000,
    pingTimeout: 25_000,
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
