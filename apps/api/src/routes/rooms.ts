import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getClientIp, rateLimit } from "../middleware";
import {
  createRoomSchema,
  purgeRoomSchema,
  roomTokenParamsSchema,
  verifyPasswordSchema,
} from "../schemas/roomSchema";
import {
  createRoom,
  getRoomMetadata,
  purgeRoom,
  verifyPassword,
} from "../services/roomService";
import type { AppEnv } from "../types";

export const roomRoutes = new Hono<AppEnv>()
  // create a room
  .post(
    "/",
    rateLimit({ action: "room_create", limit: 10, windowMs: 60_000 }),
    zValidator("json", createRoomSchema),
    async c => {
      const body = c.req.valid("json");
      const room = await createRoom(body);

      return c.json(
        {
          success: true,
          data: room,
        },
        201
      );
    }
  )
  // get room metadata
  .get("/:token", zValidator("param", roomTokenParamsSchema), async c => {
    const { token } = c.req.valid("param");
    const metadata = await getRoomMetadata(token);

    return c.json(
      {
        success: true,
        data: metadata,
      },
      200
    );
  })
  // verify password proof
  .post(
    "/:token/verify",
    rateLimit({
      action: "verify_password",
      limit: 5,
      windowMs: 60_000,
      key: c => `${getClientIp(c)}:${c.req.param("token")}`,
    }),
    zValidator("param", roomTokenParamsSchema),
    zValidator("json", verifyPasswordSchema),
    async c => {
      const { token } = c.req.valid("param");
      const { passwordProof } = c.req.valid("json");

      await verifyPassword({ token, passwordProof });

      return c.json(
        {
          success: true,
          verified: true,
        },
        200
      );
    }
  )
  // delete room
  .delete(
    "/:token",
    zValidator("param", roomTokenParamsSchema),
    zValidator("json", purgeRoomSchema),
    async c => {
      const { token } = c.req.valid("param");
      const body = c.req.valid("json");
      const creatorKey = c.req.header("x-creator-key") ?? body?.creatorKey;
      const passwordProof = body?.passwordProof;

      await purgeRoom({ token, creatorKey, passwordProof });

      return c.json(
        {
          success: true,
          message: "Room purged successfully",
        },
        200
      );
    }
  );
