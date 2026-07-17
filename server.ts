import { createServer } from 'node:http';
import { parse } from 'node:url';
import type { Server as IOServer } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = '0.0.0.0';

// Cold-start contract (Fly scale-to-zero): the proxy only retries the TCP
// connect for ~8s after waking the machine, while loading next/socket.io/game
// modules plus Next's prepare() takes most of that on a cold shared-cpu
// machine. So this file keeps its top-level imports tiny (node:http/url +
// types), binds the port first, and pulls in everything heavy via dynamic
// import inside `ready`. Early requests just wait on `ready` inside an
// established connection, which the proxy holds far longer than the connect
// window. Don't add static imports here without re-measuring wake time.
let io: IOServer | undefined;

const httpServer = createServer(async (req, res) => {
  const parsedUrl = parse(req.url ?? '/', true);
  // Liveness / warmup probe for uptime pings and launch-day checks. Answered
  // here (before Next, before `ready`) so it stays cheap and never touches
  // room state.
  if (parsedUrl.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  const handle = await ready;
  return handle(req, res, parsedUrl);
});

const ready = (async () => {
  const { default: next } = await import('next');
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const [{ Server }, { attachSocketHandlers }] = await Promise.all([
    import('socket.io'),
    import('./src/server/socket'),
  ]);

  // No cookie-based auth (tokens travel in socket payloads / sessionStorage), so
  // credentials are unnecessary. In prod set ALLOWED_ORIGIN to the deployed host;
  // unset falls back to `false` (cross-origin denied — same-origin still works) so
  // no deployment URL is baked into the public source. Dev keeps `true` so
  // localhost + LAN QR testing keeps working.
  const allowedOrigin = dev
    ? true
    : process.env.ALLOWED_ORIGIN ?? false;

  // Attached after listen — a socket.io client that connects in this window gets
  // a 404 on /socket.io/ and retries; in practice players connect only after a
  // page load, which itself awaits `ready` above.
  io = new Server(httpServer, {
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
  return handle;
})();

// Runtime fault net. This is a single in-memory instance: a hard crash drops
// every live room at once, so a fault isolated to one connection must NOT take
// the process down. Root-cause guards live in the socket handlers (try/catch);
// these only log what slips through and keep serving everyone else.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// Graceful shutdown (Fly sends SIGTERM on deploy/restart; Ctrl-C sends SIGINT).
// Tell every connected client a restart is coming so they can show a notice and
// reconnect once the new machine is up, then stop accepting work and exit. Rooms
// are memory-only and intentionally not persisted, so this is a courtesy notice,
// not a state save.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`> ${signal} received — shutting down`);
  io?.emit('server:shutdown', {});
  // Give the notice a moment to flush, then close listeners and exit. Force-exit
  // after a hard cap so a stuck connection can't block the deploy.
  setTimeout(() => {
    io?.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }, 700);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

httpServer.listen(port, hostname, () => {
  console.log(`> Listening on http://${hostname}:${port} (dev=${dev})`);
});

// Startup failure must still crash the process (listen may already have
// succeeded, so nothing else would surface it) — a half-alive server that 500s
// every page is worse than letting Fly restart the machine.
ready
  .then(() => console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
