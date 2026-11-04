import type { Context } from "hono";
import type { Logger } from "./lib/logger";

interface AppVariables {
  requestId: string;
  logger: Logger;
}

export type AppEnv = {
  Variables: AppVariables;
};

export type AppContext = Context<AppEnv>;
