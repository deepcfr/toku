import { hexToBytes } from "@toku/crypto";
import { encode, MessageType } from "@toku/protocol";
import { broadcastToRoom } from "../services/messageService";
import {
  getAllOnlineMembers,
  refreshHeartbeat,
} from "../services/presenceService";

// renews the 20s presence lease in redis when a client sends PRESENCE_PING
export async function handlePresencePing(
  roomToken: string,
  pubKeyHash: string
): Promise<void> {
  await refreshHeartbeat({ roomToken, pubKeyHash });
}

// fetches all online members from redis, encodes a ROOM_STATE frame, and broadcasts to the room
export async function broadcastRoomState(roomToken: string): Promise<void> {
  const onlineHexList = await getAllOnlineMembers(roomToken);
  const members = onlineHexList.map(hex => hexToBytes(hex));

  const frame = encode({
    type: MessageType.ROOM_STATE,
    roomToken,
    members,
  });

  await broadcastToRoom(roomToken, frame);
}
