import type { WSContext } from "hono/ws";
import { encode, MessageType } from "@toku/protocol";
import { logger } from "../lib/logger";
import {
  fetchPendingFromDb,
  fetchPendingFromQueue,
} from "../services/messageService";
import { setUserOffline, setUserOnline } from "../services/presenceService";
import { startFanout, stopFanout } from "./fanout";
import { handleIncomingMessage } from "./message";
import { broadcastRoomState } from "./presence";
import { connectionRegistry } from "./registry";

// converts incoming WebSocket data payload to Uint8Array
export function toUint8Array(
  data: string | Blob | ArrayBufferLike | ArrayBufferView
): Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

// delivers pending offline messages upon reconnect (Redis RAM fast path -> DB disk fallback)
export async function deliverCatchUpMessages(
  roomToken: string,
  pubKeyHash: string,
  ws: WSContext
): Promise<void> {
  try {
    // fast path -> read from 10m sliding Redis offline hash queue (RAM)
    const pendingFrames = await fetchPendingFromQueue(pubKeyHash);
    if (pendingFrames.length > 0) {
      for (const frame of pendingFrames) {
        ws.send(frame as Uint8Array<ArrayBuffer>);
      }
      return;
    }

    // fallback path -> query PostgreSQL pending receipts (Disk)
    const dbRows = await fetchPendingFromDb(pubKeyHash);
    for (const row of dbRows) {
      if (row.room_token !== roomToken) continue;
      const frame = encode({
        type: MessageType.CHAT_MESSAGE,
        roomToken: row.room_token,
        from: pubKeyHash,
        msgId: row.message_id,
        timestamp: BigInt(new Date(row.created_at).getTime()),
        iv: new Uint8Array(row.iv),
        cipherText: new Uint8Array(row.ciphertext),
        burn: false,
      });
      ws.send(frame as Uint8Array<ArrayBuffer>);
    }
  } catch (error) {
    logger.error(
      { error, roomToken, pubKeyHash },
      "failed to deliver catch-up messages"
    );
  }
}

// handles the open event when a client establishes a WebSocket connection
export async function handleOpen(
  roomToken: string,
  pubKeyHash: string,
  ws: WSContext
): Promise<void> {
  const isFirstLocal = !connectionRegistry.hasRoom(roomToken);

  connectionRegistry.register(roomToken, pubKeyHash, ws);
  await setUserOnline({ roomToken, pubKeyHash });

  if (isFirstLocal) {
    await startFanout(roomToken);
  }

  await deliverCatchUpMessages(roomToken, pubKeyHash, ws);
  await broadcastRoomState(roomToken);

  logger.info({ roomToken, pubKeyHash }, "client connected to room websocket");
}

// handles incoming binary messages over the WebSocket
export async function handleMessage(
  roomToken: string,
  pubKeyHash: string,
  data: string | Blob | ArrayBufferLike
): Promise<void> {
  const rawBytes = toUint8Array(data);
  if (!rawBytes) {
    logger.warn(
      { roomToken, pubKeyHash },
      "dropped non-binary websocket frame"
    );
    return;
  }

  await handleIncomingMessage(roomToken, pubKeyHash, rawBytes);
}

// handles socket close when a client disconnects or leaves
export async function handleClose(
  roomToken: string,
  pubKeyHash: string
): Promise<void> {
  connectionRegistry.unregister(roomToken, pubKeyHash);
  await setUserOffline({ roomToken, pubKeyHash });

  if (!connectionRegistry.hasRoom(roomToken)) {
    await stopFanout(roomToken);
  }

  await broadcastRoomState(roomToken);

  logger.info(
    { roomToken, pubKeyHash },
    "client disconnected from room websocket"
  );
}

// handles socket errors
export function handleError(
  roomToken: string,
  pubKeyHash: string,
  error: unknown
): void {
  logger.error({ error, roomToken, pubKeyHash }, "websocket error occurred");
  connectionRegistry.unregister(roomToken, pubKeyHash);
}
