import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import {
  corsMiddleware,
  errorHandler,
  notFoundHandler,
  requestId,
  requestLogger,
} from "./middleware";
import { healthRoutes } from "./routes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// middlewares
app.use("*", requestId);
app.use("*", requestLogger);
app.use("*", corsMiddleware);
app.use("*", prettyJSON());

// health checks, unversioned
app.route("/health", healthRoutes);

// mount all the routes, versioned
export const apiRoutes = app.basePath("/v1/api");

// global error handler
app.onError(errorHandler);

// not found error handler
app.notFound(notFoundHandler);

export default app;

// rpc
export type ApiType = typeof apiRoutes;
