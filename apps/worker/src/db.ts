import { createDbClient } from "@toku/db";
import { config } from "./config";

export const db = createDbClient(config.DATABASE_URL);
