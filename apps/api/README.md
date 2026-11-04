# @toku/api

Hono HTTP REST and WebSocket gateway for Toku, running on Bun.

## Architecture Overview

- **HTTP Framework**: [Hono](https://hono.dev/) on Bun runtime.
- **WebSocket Gateway**: Native Bun WebSockets via `createBunWebSocket` (`hono/bun`).
- **RPC & End-to-End Type Safety**: Hono RPC (`hc`) exporting `AppType` for `@toku/client`.
- **Infrastructure Singletons**:
  - Postgres client pool via `@toku/db`.
  - 3 dedicated Redis clients via `@toku/redis`:
    1. `client`: General commands (sliding-window rate limiter, presence leases, room metadata, offline queue).
    2. `pub`: Dedicated publisher for multi-node event broadcasting.
    3. `sub`: Dedicated subscriber for inter-server fanout (subscribing blocks regular commands).

---

## Folder Structure

```
src/
├── index.ts              -- process entry, Bun.serve with websocket handler, graceful shutdown
├── app.ts                -- hono factory, registers middleware, mounts routes, exports AppType
├── config.ts             -- typed env config, fails fast on boot
├── db.ts                 -- postgres client singleton (@toku/db)
├── types.ts              -- server-only shared types (including AppEnv for Hono context)
├── redis.ts              -- 3-client redis singleton: client, pub, sub (@toku/redis)
│
├── middleware/           -- hono middleware & global lifecycle hooks
│   ├── index.ts          -- re-exports all middleware
│   ├── requestId.ts      -- generates request ID and attaches child logger to c.var
│   ├── logger.ts         -- access log and request duration timing
│   ├── cors.ts           -- wrapper over hono/cors (configured for @toku/client)
│   ├── rateLimit.ts      -- rate limiting guard around Redis Lua sliding-window
│   ├── metrics.ts        -- http request duration histogram
│   └── errorHandler.ts   -- global app.onError (AppError, 429, 500) & app.notFound handlers
│
├── routes/               -- HTTP REST controllers (Hono sub-apps)
│   ├── index.ts          -- mounts sub-apps and exports route types for Hono RPC
│   ├── health.ts         -- GET /health (liveness), GET /health/ready (readiness)
│   ├── rooms.ts          -- POST /rooms, GET /rooms/:token
│   ├── rooms.schema.ts   -- zod schemas for room input validation (zValidator)
│   └── metrics.ts        -- GET /metrics (prometheus-compatible scrape endpoint)
│
├── ws/                   -- WebSocket gateway (binary protocol frames)
│   ├── adapter.ts        -- createBunWebSocket() singleton, exports upgradeWebSocket & websocket
│   ├── index.ts          -- WS route definition (/rooms/:token/ws)
│   ├── connection.ts     -- socket open, close, and error lifecycle handlers
│   ├── registry.ts       -- local socket registry (tracks active sockets per room on this node)
│   ├── fanout.ts         -- Redis subscriber listener forwarding cluster events to local sockets
│   ├── message.ts        -- binary frame decoding (@toku/protocol) and service dispatch
│   └── presence.ts       -- heartbeat renewals and typing indicator frames
│
├── services/             -- pure business logic (no HTTP/WS transport awareness)
│   ├── roomService.ts    -- room creation, lookup, and password verification
│   ├── presenceService.ts-- presence leases and active member counts
│   └── messageService.ts -- message fanout, offline queueing, delivery ACKs
│
├── lib/                  -- shared helpers
│   ├── errors.ts         -- AppError domain classes
│   └── logger.ts         -- base pino logger instance
```

---

## Layers & Responsibilities

1. **Routes (`src/routes`)**:
   Handle HTTP requests, validate input shapes using Zod schemas, and delegate business operations to services.
2. **Middleware (`src/middleware`)**:
   Cross-cutting concerns applied to requests (request tracing, structured duration logging, CORS preflights, and sliding-window rate limiting).
3. **WebSockets (`src/ws`)**:
   - `adapter.ts`: Bridges Hono route matching with Bun's native WebSocket engine.
   - `registry.ts`: Maintains the in-memory map of local sockets connected to this specific server node.
   - `fanout.ts`: Listens to Redis pub/sub channels and broadcasts cross-node messages down to matching local sockets in the registry.
   - `message.ts`: Codec layer converting raw binary frames into domain events.
4. **Services (`src/services`)**:
   Core application logic and coordination between `@toku/db` and `@toku/redis`.
5. **Core Infrastructure (`src/db.ts`, `src/redis.ts`, `src/config.ts`)**:
   Singletons managing connections, pools, and environment validation.

---

## Commands

```bash
bun run dev          # run with hot reload
bun run check-types  # typecheck via tsc
bun run lint         # run eslint
bun run build        # bundle to dist/
bun run start        # run compiled bundle
```
