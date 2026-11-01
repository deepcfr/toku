# @toku/api

Elysia HTTP REST and WebSocket gateway for Toku.

## Structure

```
src/
├── index.ts              -- process entry, server listen, graceful shutdown
├── app.ts                -- elysia factory, registers plugins/routes, exports App type
├── config.ts             -- typed env config, fails fast on boot
├── db.ts                 -- postgres client singleton (@toku/db)
├── redis.ts              -- redis client and pub/sub singletons (@toku/redis)
│
├── plugins/              -- elysia lifecycle plugins
│   ├── index.ts          -- re-exports all plugins
│   ├── cors.ts           -- CORS setup for @toku/client
│   ├── logger.ts         -- request duration and access logging
│   ├── errors.ts         -- global error handler (AppError, 429, 500)
│   ├── rateLimit.ts      -- redis sliding-window rate limit guard
│   └── metrics.ts        -- process uptime and memory stats
│
├── routes/               -- HTTP REST controllers
│   ├── index.ts          -- mounts all route groups
│   ├── health.ts         -- GET /health (liveness), GET /health/ready (readiness)
│   └── rooms.ts          -- POST /rooms, GET /rooms/:token
│
├── ws/                   -- WebSocket gateway (binary protocol frames)
│   ├── index.ts          -- WS route definition (/rooms/:token/ws)
│   ├── connection.ts     -- socket open, close, and error lifecycle
│   ├── message.ts        -- frame decoding (@toku/protocol) and service dispatch
│   └── presence.ts       -- heartbeat and typing indicator frames
│
├── services/             -- business logic (no HTTP/WS awareness)
│   ├── roomService.ts    -- room creation, lookup, and password verification
│   ├── presenceService.ts-- presence leases and active member counts
│   └── messageService.ts -- message fanout, offline queueing, delivery ACKs
│
├── lib/                  -- shared helpers
│   ├── errors.ts         -- AppError domain classes
│   └── logger.ts         -- pino logger instance
│
└── types/
    └── index.ts          -- server-only shared types
```

## Layers

- **Routes (`src/routes`)**: Handle HTTP requests, validate input shapes, return JSON.
- **Services (`src/services`)**: Business rules, database queries, and Redis coordination.
- **WebSockets (`src/ws`)**: Binary protocol decoding, connection tracking, real-time dispatch.
- **Plugins (`src/plugins`)**: Cross-cutting hooks (logging, errors, CORS, rate limits).
- **Core (`src/db.ts`, `src/redis.ts`, `src/config.ts`)**: Infrastructure singletons.

## Commands

```bash
bun run dev          # run with hot reload
bun run check-types  # typecheck via tsc
bun run lint         # run eslint
bun run build        # bundle to dist/
bun run start        # run compiled bundle
```
