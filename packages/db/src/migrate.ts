import { readdir, readFile } from "fs/promises";
import { join } from "path";
import postgres from "postgres";

// import.meta.dir tells the location of this file
// join it with "migrations" to select the migrations folder
const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

export async function runMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, {
    max: 1,
    transform: { undefined: null },
  });

  try {
    // create tracking system ledger
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // get local file names
    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith(".sql"))
      .sort();

    // see what the db already remembers
    const ran = await sql<
      { filename: string }[]
    >`SELECT filename FROM _migrations ORDER BY filename`;

    const ranSet = new Set(ran.map(r => r.filename));

    // run the migration loop
    for (const file of files) {
      if (ranSet.has(file)) {
        console.log(`[migrate] skipping ${file} - already ran`);
        continue;
      }

      const content = await readFile(join(MIGRATIONS_DIR, file), "utf-8");

      await sql.begin(async sql => {
        await sql.unsafe(content);
        await sql`INSERT INTO _migrations (filename) VALUES (${file})`;
      });

      console.log(`[migrate] ran ${file}`);
    }

    console.log("[migrate] all migrations complete");
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL is required");
    process.exit(1);
  }
  try {
    new URL(url);
  } catch {
    console.error("[migrate] DATABASE_URL must be a valid URL");
    process.exit(1);
  }
  await runMigrations(url);
  process.exit(0);
}
