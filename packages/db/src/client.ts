// reusable postgres client
import postgres from "postgres";

export function createDbClient(
  connectionString: string,
  options: postgres.Options<{}> = {}
) {
  return postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: options.idle_timeout ?? 30,
    connect_timeout: options.connect_timeout ?? 10,
    ssl: options.ssl ?? false,
    transform: {
      undefined: null,
      ...postgres.camel,
    },
    ...options,
  });
}

export type DbClient = ReturnType<typeof createDbClient>;
