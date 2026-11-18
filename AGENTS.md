# AGENTS.md

Repository specification, architecture invariants, and operating guidelines for developers and AI agents working on `toku`.

---

## 1. Project Overview

`toku` is an anonymous, end-to-end encrypted (E2EE), ephemeral room communication platform built on a zero-knowledge server architecture.

- **Zero-Knowledge**: Servers and databases never see plaintext message contents or private keys. The backend strictly routes and stores encrypted binary payloads (ciphertext + AES-GCM auth tag + 12-byte IV).
- **Identity Model**: No usernames, passwords, or emails. Users are identified strictly by their cryptographic `pubKeyHash` (derived from their public identity key).
- **Custom Binary Wire Protocol**: All client WebSocket communication uses raw binary frames (`Uint8Array`) parsed via `DataView` with strict bounds checking. No JSON is transmitted over client WebSockets.
- **Strict Ephemeral Lifespans**: Rooms have non-extending lifespans (e.g., 15m, 1h, 24h). Activity never extends room expiration.
- **Core Technology Stack**: Bun runtime, Turborepo, Hono (REST API + `@hono/bun` WebSockets), Redis (ioredis), PostgreSQL (postgres.js), BullMQ.

---

## 2. Workspaces & Monorepo Topology

Package manager is **Bun only** (`devEngines.packageManager` pins Bun; lockfile is `bun.lock`). Never use npm, pnpm, or yarn.

### Applications (`apps/`)

- `apps/api` (`@toku/api`): Hono HTTP REST lifecycle API + real-time WebSocket gateway via `@hono/bun`.
- `apps/worker` (`@toku/worker`): Background worker consuming BullMQ queues (ephemeral room cleaner, message sweeper, push delivery processing).
- `apps/web` (`@toku/client`): Frontend client built with Vite, React, and Tailwind CSS.
  > [!NOTE]
  > Note directory name vs. package name: Directory is `apps/web`, but package name is `@toku/client`. Filter by `@toku/client`.

### Shared Packages (`packages/`)

- `packages/crypto` (`@toku/crypto`): Cryptographic primitives (XChaCha20-Poly1305, Ed25519, hashing, key derivation).
- `packages/protocol` (`@toku/protocol`): Binary wire protocol encoder and decoder (`Uint8Array`, `DataView`, magic byte `0xaa`).
- `packages/redis` (`@toku/redis`): Redis client (ioredis), presence leases, room Pub/Sub fanout, offline hash inbox queue.
- `packages/db` (`@toku/db`): PostgreSQL driver (postgres.js), migrations runner (`bun run db:migrate`), schema types.
- `packages/env` (`@toku/env`): Type-safe zod schema validation for environment variables.
- `packages/typescript-config` (`@toku/typescript-config`): Shared TypeScript configurations (`base.json`, `node.json`, `vite-react.json`).
- `packages/eslint-config` (`@toku/eslint-config`): Shared ESLint configurations (`/base` for backend/shared, `/react` for Vite React).

---

## 3. Development Commands & Operations

### Monorepo Tasks (via Turborepo)

- `bun run dev`: Start all apps in watch/development mode.
- `bun run build`: Build all packages and applications (`dist/**`).
- `bun run check-types`: Monorepo typechecking across all workspaces (`tsc --noEmit`).
- `bun run lint`: Run ESLint across all workspaces.
- `bun run lint:fix`: Run ESLint with auto-fix enabled across all workspaces.
- `bun run format`: Format repository files with Prettier.
- `bun run format:check`: Check formatting without modifying files.
- `bun run test`: Run test suites across all workspaces (`test` depends on `^build`).
- `bun run db:migrate`: Run PostgreSQL migrations inside `@toku/db` using root `.env`.

### Single Workspace Targeting

Target individual workspaces using the `--filter` flag:

- `bun run --filter @toku/api dev`
- `bun run --filter @toku/api test`
- `bun run --filter @toku/client lint -- --fix`
- `bun run --filter @toku/db db:migrate`

### Local Infrastructure

Local dependencies run through Docker:

- `docker compose up -d postgres redis`: Start PostgreSQL (port `5432`) and Redis (port `6379`).

---

## 4. Code Quality, Formatting & Tooling Invariants

### ESLint

- **Pinned to ESLint 9**: ESLint is pinned to v9 repo-wide because `eslint-plugin-react` (used in `@toku/eslint-config/react`) caps peer support at ESLint 9. Do not bump root ESLint to v10 until upstream plugin support lands.
- **`eslint-plugin-only-warn`**: Base config uses `eslint-plugin-only-warn`. All rule violations report as warnings, so `lint` commands exit with code `0` even if code contains lint warnings. Always read the command output; do not rely solely on the exit code.

### TypeScript

- **Shared Strictness (`base.json`)**: Configures `strict: true` and `noUncheckedIndexedAccess: true`. Indexing arrays or records returns `T | undefined`.
- **Backend Packages**: Extend `@toku/typescript-config/node.json` (`NodeNext` module resolution, declaration emission).
- **Frontend Packages**: Extend `@toku/typescript-config/vite-react.json` (`bundler` module resolution, DOM libs, `vite/client` types, `noEmit: true`).

### Prettier & Formatting

- **Configuration Settings**: Double quotes (`"singleQuote": false`), `arrowParens: "avoid"`, ES5 trailing commas (`"trailingComma": "es5"`), 80-character print width.
- **Import Sorting**: Uses `@ianvs/prettier-plugin-sort-imports` with import order:
  `["^bun$", "<THIRD_PARTY_MODULES>", "^@toku/(.*)$", "^[./]"]`.
  > [!WARNING]
  > Never switch to the unscoped `prettier-plugin-sort-imports`. It is an incompatible fork without `importOrder` support that silently ignores options and breaks grouping.
- **Tailwind Plugin**: `prettier-plugin-tailwindcss` sorts utility classes automatically.
- **Pre-commit Hooks**: Husky + lint-staged runs per-workspace `lint --fix` and Prettier on staged files. Run `bun run format` to ensure clean commits.

### Turborepo Rules

- `test` depends on `^build`.
- `build` outputs to `dist/**`.
- Undeclared environment variables in builds trigger `turbo/no-undeclared-env-vars`. Declare required variables in [turbo.json](file:///Users/deep/Dev/toku/turbo.json). Root `.env*` files are recognized build inputs.

---

## 5. Architectural & Protocol Invariants

### Database (PostgreSQL)

- **Pure `snake_case`**: All table names and column names must be pure `snake_case` across SQL migrations and raw queries.
- **No Automatic CamelCase**: `postgres.camel` is disabled. Database rows match SQL columns directly.
- **Standard Column Naming**: The message identifier column is named `message_id` across all tables, types, and queries (never `msg_id`).
- **Cascade Deletes**: All room-dependent data (messages, participants, delivery receipts) must reference `rooms(token)` with `ON DELETE CASCADE`. Destroying or expiring a room cleans up all associated records automatically.
- **Partial Index Optimization**: Queries fetching pending offline messages rely on partial index `idx_delivery_pending_recipient` (`WHERE delivered_at IS NULL`).
- **Inline Ban Lookups**: Sockets and inbound messages verify sender status against the `active_bans` index (`WHERE expires_at > NOW()`).

### Binary Wire Protocol

- **Magic Byte**: Every valid WebSocket binary frame must begin with magic byte `0xaa` (`PROTOCOL_MAGIC_BYTE`).
- **Zero JSON**: No JSON is transmitted across client WebSockets. All frames use `Uint8Array` with `DataView` offsets and bounds checking.
- **Opcode Specification**:
  - `0x01`: `JOIN_ROOM`
  - `0x02`: `LEAVE_ROOM`
  - `0x03`: `CHAT_MESSAGE`
  - `0x04`: `KEY_EXCHANGE`
  - `0x05`: `DELIVERY_ACK`
  - `0x06`: `PRESENCE_PING`
  - `0x07`: `ROOM_STATE`
  - `0x08`: `ERROR`

### Redis Transit & In-Memory State

- **Atomic Room Creation & TTLs**: Room keys (`toku:room:<token>`, `toku:room:<token>:members`, `toku:room:<token>:keys`) are created atomically with `durationSeconds`. Joining or leaving fetches remaining TTL (`redis.ttl`) and restamps keys so room lifespans never extend.
- **Presence Leases**: Heartbeat leases (`toku:presence:<token>:<pubKeyHash>`) have a 20-second TTL renewed periodically with 7-second heartbeat pings.
- **Offline Inbox Hash**: Undelivered messages for offline room members buffer in Redis Hash `toku:offline:<recipientHash>` under field `<roomToken>:<messageId>` with a 10-minute sliding TTL (`EXPIRE 600`).
- **$O(1)$ Surgical Eviction**: Receiving a `DELIVERY_ACK` evicts the message from Redis using `HDEL toku:offline:<recipientHash> "<roomToken>:<messageId>"` without scanning.
- **Redis Pub/Sub Fanout**: Servers publish untouched `Uint8Array` frames to `toku:channel:<roomToken>` for live fanout to connected peer servers.
- **In-Memory Registry**: Local WebSocket connections are tracked in an in-memory nested map (`Map<roomToken, Map<pubKeyHash, WSContext>>`) with lifecycle hooks in `apps/api/src/ws/registry.ts`.
- **WebSocket Adapter**: WebSockets use official `@hono/bun` exports (`upgradeWebSocket`, `websocket`) wired directly into `Bun.serve`.

### BullMQ Background Queue

- **Queue Name**: `toku-worker`.
- **Job Types**:
  - `TRACK_MESSAGE`: Asynchronously writes message metadata, ciphertext, and delivery receipt rows to PostgreSQL.
  - `MARK_DELIVERED`: Asynchronously marks delivery receipt timestamps in PostgreSQL.
- **Retry & Resilience**: Configured with 3 attempts, exponential backoff, and 50% jitter (`delay: 1000`, `jitter: 0.5`, `removeOnComplete: true`, `removeOnFail: { count: 1000 }`).
- **Graceful Shutdown**: All queues and workers register cleanup handlers (`closeQueue()`) wired to `SIGINT` and `SIGTERM`.

---

## 6. Agent Rules of Engagement

When assisting or collaborating on this codebase, AI agents must adhere strictly to these principles:

1. **Pedagogical Collaboration ("Teach me everything so that I can write on my own")**:
   - Guide, teach, and explain mechanics step-by-step. Break problems into modular, manageable concepts.
   - Do not dump large pre-written blocks of code or complete tasks ahead of the developer unless explicitly requested.
2. **Mermaid Diagrams**:
   - Use Mermaid for workflows in repository architecture documentation when it improves clarity.
   - Do not add Mermaid to chat or generated artifacts unless the developer explicitly requests it; prefer Markdown lists or tables otherwise.
3. **Theme-Agnostic Terminology**:
   - Maintain professional, neutral terminology.
   - Strictly avoid fantasy, gaming, or RPG-themed terms (e.g., "campfire", "ember", "obsidian", "creature", "tamagotchi", "hatch", "flame"). Use accurate technical domain names (rooms, tokens, members, participants, messages, leases, relays).
4. **No AI Slop or Robotic Comments**:
   - Write clean, natural, production-grade code.
   - Avoid artificial comment banners (e.g., `// ==================`, `// --- STEP 1 ---`) and repetitive robotic prefixes.
5. **Markdown File Links**:
   - Every referenced file must be linked using markdown links with the `file://` scheme and use file basenames for link text (e.g. `[AGENTS.md](file:///Users/deep/Dev/toku/AGENTS.md)`).
