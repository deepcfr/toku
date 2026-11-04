import { cors } from "hono/cors";
import { config } from "../config";

export const corsMiddleware = cors({
  origin: config.WEB_ORIGIN,
  allowMethods: ["GET", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  credentials: false,
  maxAge: 86400,
});
