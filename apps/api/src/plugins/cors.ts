import cors from "@elysia/cors";
import Elysia from "elysia";
import { config } from "../config";

export const corsPlugin = new Elysia({ name: "plugin:cors" }).use(
  cors({
    origin: config.WEB_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type"],
    credentials: false,
  })
);
