import { createDbClient } from "@toku/db";
import { config } from "./config";

// postgres client singleton
export const db = createDbClient(config.DATABASE_URL);
