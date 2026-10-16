# toku

> **Temporary v1 README** — bare-bones on purpose. Updated and polished as the repo evolves.

Anonymous end-to-end-encrypted ephemeral chat. No signups, no accounts — a keypair generated in your browser is your identity. Rooms live on a countdown, messages can burn, and the server routes opaque bytes it can never read.

## Aim

A polished, real-time E2EE chat product: DMs and password-protected rooms with forward secrecy, offline delivery, ghost mode, burn-after-read, and self-destructing everything — built in the open, one feature at a time.

## Structure

Bun + Turborepo monorepo. Packages never import each other; `apps/*` compose them. Real-time transport is binary WebSocket frames (`[magic:1][type:1][payload]`), E2EE via X25519 + AES-256-GCM, Redis pub/sub bridging server instances, Postgres persisting receipts and bans.

```
toku/
├── apps/
│   ├── server/          # @toku/server — Fastify HTTP+WS (scaffold next)
│   ├── worker/          # @toku/worker — BullMQ sweeps (planned)
│   └── web/             # @toku/client — Vite React chat UI (planned)
├── packages/
│   ├── protocol/        # @toku/protocol — binary wire codec
│   ├── crypto/          # @toku/crypto — shared primitives (server + browser)
│   ├── redis/           # @toku/redis — rooms, presence, pub/sub, queues, rate limits
│   ├── db/              # @toku/db — Postgres client, migrations, row types
│   ├── env/             # @toku/env — zod-validated env per app
│   ├── typescript-config/
│   └── eslint-config/
├── docker-compose.yaml  # postgres:16 + redis:7 (volumes persist data)
└── bun.lock
```

## What's done

| package          | status                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@toku/protocol` | `encode`/`decode` for 8 frame types (`[magic:1][type:1][payload]`), `ProtocolError` with routable codes, byte-verified live                                        |
| `@toku/crypto`   | CSPRNG + tokens, constant-time compare, `sha256`/`pbkdf2`/`hkdf`, X25519+Ed25519 identity keys, AES-GCM — RFC vectors green                                        |
| `@toku/redis`    | room store (dynamic TTL), presence leases, pub/sub fan-out with receiver count, offline queue with ACK eviction, Lua sliding-window rate limiter — all live-tested |
| `@toku/db`       | migration runner + 6 migrations (`rooms`, `room_messages`, `delivery_receipts`, `security_incident_log`, `active_bans`), typed row shapes                          |
| `@toku/env`      | `server`/`worker`/`web` zod schemas, shared + per-app `.env.local`                                                                                                 |

## V1 features (build order)

1. Zero-knowledge identity (browser keypair + IndexedDB, no signup)
2. Shareable identity link (`toku.sh/u/handle` → public key)
3. E2EE DMs
4. E2EE rooms
5. One-time invite links
6. Ghost mode
7. Message lifetime timers
8. Burn after read (defined as after delivery/ACK)
9. Burn animation
10. Screenshot overlay (focus-loss based)
11. Self-destructing rooms

## What's next

`apps/server` scaffold (`index.ts` + `ws/` gateway + `http/` routes), then rooms → messaging → guards, one branch + PR per unit.

## Commands

```bash
bun install                  # install everything (Bun only, never npm)
bun run dev                  # run all apps
bun run check-types           # turbo typecheck across workspaces
bun run format:check          # prettier check
bun run db:migrate            # run pending Postgres migrations
docker compose up -d postgres redis  # local infra
```
