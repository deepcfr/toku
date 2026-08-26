# `@toku/db`

Postgres schema and migrations for toku.

- `src/migrations/*.sql` — raw SQL migrations, applied in filename order (`001_`, `002_`, …)
- `src/migrate.ts` — migration runner: creates a `_migrations` ledger table, applies pending files each inside a transaction, skips files already recorded
- `src/client.ts` — shared postgres.js client factory

## Migrating

Run from the repo root — it loads the **root `.env.local`** (the shared env; needs `DATABASE_URL`):

```sh
bun run db:migrate
```

The runner is idempotent: re-running only applies new migration files.

## Usage

```ts
import { createDbClient } from "@toku/db";

const db = createDbClient(process.env.DATABASE_URL!);
```
