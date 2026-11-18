import { Hono } from "hono";
import { isUserBanned } from "../services/messageService";
import { getRoomMetadata, isRoomMember } from "../services/roomService";
import type { AppEnv } from "../types";
import { upgradeWebSocket } from "./adapter";
import {
  handleClose,
  handleError,
  handleMessage,
  handleOpen,
} from "./connection";

export const wsRoutes = new Hono<AppEnv>().get(
  "/:token/ws",
  upgradeWebSocket(c => {
    const token = c.req.param("token");
    const pubKeyHash = c.req.query("pubKeyHash");

    return {
      async onOpen(_event, ws) {
        if (!token || !pubKeyHash) {
          ws.close(1008, "Missing roomToken or pubKeyHash");
          return;
        }

        // connection gate -> inline ban check against PostgreSQL active_bans
        const banned = await isUserBanned(pubKeyHash);
        if (banned) {
          ws.close(1008, "Banned");
          return;
        }

        // room gate -> verify room exists in Redis
        const room = await getRoomMetadata(token);
        if (!room) {
          ws.close(1002, "Room not found");
          return;
        }

        // membership gate -> verify user has joined this room
        const isMember = await isRoomMember({ roomToken: token, pubKeyHash });
        if (!isMember) {
          ws.close(1008, "Unauthorized member");
          return;
        }

        await handleOpen(token, pubKeyHash, ws);
      },

      onMessage(event) {
        if (!token || !pubKeyHash) return;
        void handleMessage(token, pubKeyHash, event.data);
      },

      onClose() {
        if (!token || !pubKeyHash) return;
        void handleClose(token, pubKeyHash);
      },

      onError(event) {
        if (!token || !pubKeyHash) return;
        handleError(token, pubKeyHash, event);
      },
    };
  })
);

export * from "./adapter";
export * from "./registry";
export * from "./fanout";
export * from "./presence";
export * from "./message";
export * from "./connection";
