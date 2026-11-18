import { bytesToHex } from "@toku/crypto";
import {
  decode,
  MessageType,
  type ChatMessage,
  type DeliveryAckMessage,
} from "@toku/protocol";
import { logger } from "../lib/logger";
import {
  broadcastToRoom,
  evictOfflineMessage,
  isUserBanned,
  pushMarkDeliveredJob,
  pushTrackMessageJob,
  queueOfflineMessage,
} from "../services/messageService";
import { isUserOnline } from "../services/presenceService";
import { getRoomMembers, isRoomMember } from "../services/roomService";
import { handlePresencePing } from "./presence";

// handles inbound CHAT_MESSAGE (0x03) frame
async function handleChat(
  roomToken: string,
  senderPubKeyHash: string,
  msg: ChatMessage,
  rawBytes: Uint8Array
): Promise<void> {
  // verify sender is an active member of this room
  const isMember = await isRoomMember({
    roomToken,
    pubKeyHash: senderPubKeyHash,
  });
  if (!isMember) {
    logger.warn(
      { roomToken, senderPubKeyHash },
      "dropped chat message from non-member"
    );
    return;
  }

  // verify sender is not banned
  const banned = await isUserBanned(senderPubKeyHash);
  if (banned) {
    logger.warn(
      { roomToken, senderPubKeyHash },
      "dropped chat message from banned sender"
    );
    return;
  }

  // fetch all room members to identify recipients
  const allMembers = await getRoomMembers(roomToken);
  const recipientHashes = allMembers.filter(
    member => member !== senderPubKeyHash
  );

  // push message metadata and PENDING delivery receipts to worker queue
  await pushTrackMessageJob({
    type: "TRACK_MESSAGE",
    roomToken,
    msgId: msg.msgId,
    ciphertextHex: bytesToHex(msg.cipherText),
    ivHex: bytesToHex(msg.iv),
    recipientHashes,
    createdAt: Number(msg.timestamp),
  });

  // route to offline queue for any members not currently connected
  for (const recipientHash of recipientHashes) {
    const online = await isUserOnline({ roomToken, pubKeyHash: recipientHash });
    if (!online) {
      await queueOfflineMessage({
        pubKeyHash: recipientHash,
        roomToken,
        msgId: msg.msgId,
        payload: rawBytes,
      });
    }
  }

  // fan out untouched raw binary bytes to all servers listening to this room
  await broadcastToRoom(roomToken, rawBytes);
}

// handles inbound DELIVERY_ACK (0x05) frame
async function handleAck(
  roomToken: string,
  recipientPubKeyHash: string,
  msg: DeliveryAckMessage
): Promise<void> {
  // evict message from redis offline hash queue (O(1) HDEL)
  await evictOfflineMessage({
    pubKeyHash: recipientPubKeyHash,
    roomToken,
    msgId: msg.msgId,
  });

  // push MARK_DELIVERED job to background worker queue
  await pushMarkDeliveredJob({
    type: "MARK_DELIVERED",
    roomToken,
    msgId: msg.msgId,
    recipientHash: recipientPubKeyHash,
    deliveredAt: Date.now(),
  });
}

// main router for all incoming binary frames from client websockets
export async function handleIncomingMessage(
  roomToken: string,
  senderPubKeyHash: string,
  rawBytes: Uint8Array
): Promise<void> {
  let msg;
  try {
    msg = decode(rawBytes);
  } catch (error) {
    logger.warn({ error, roomToken }, "failed to decode incoming binary frame");
    return;
  }

  // verify room token matches the socket connection
  if ("roomToken" in msg && msg.roomToken !== roomToken) {
    logger.warn(
      { roomToken, msgRoomToken: msg.roomToken },
      "dropped frame with mismatched room token"
    );
    return;
  }

  // anti-spoofing: verify sender identity matches socket credentials
  if ("from" in msg && msg.from !== senderPubKeyHash) {
    logger.warn(
      { senderPubKeyHash, msgFrom: msg.from },
      "dropped frame with mismatched sender identity"
    );
    return;
  }

  switch (msg.type) {
    case MessageType.CHAT_MESSAGE:
      await handleChat(roomToken, senderPubKeyHash, msg, rawBytes);
      break;

    case MessageType.DELIVERY_ACK:
      await handleAck(roomToken, senderPubKeyHash, msg);
      break;

    case MessageType.PRESENCE_PING:
      await handlePresencePing(roomToken, senderPubKeyHash);
      break;

    case MessageType.KEY_EXCHANGE:
      // forward raw pairwise key exchange frame to the room
      await broadcastToRoom(roomToken, rawBytes);
      break;

    default:
      logger.debug(
        { type: msg.type, roomToken },
        "unhandled frame type in message router"
      );
      break;
  }
}
