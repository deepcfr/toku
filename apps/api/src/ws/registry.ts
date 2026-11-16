import type { WSContext } from "hono/ws";

// nested map to store roomToken -> (pubKeyHash -> WSContext)
const rooms = new Map<string, Map<string, WSContext>>();

export const connectionRegistry = {
  register(roomToken: string, pubKeyHash: string, ws: WSContext): void {
    let room = rooms.get(roomToken);
    if (!room) {
      room = new Map();
      rooms.set(roomToken, room);
    }
    room.set(pubKeyHash, ws);
  },

  unregister(roomToken: string, pubKeyHash: string): void {
    const room = rooms.get(roomToken);
    if (!room) return;

    room.delete(pubKeyHash);

    // clean up empty room map to prevent memory leaks
    if (room.size === 0) {
      rooms.delete(roomToken);
    }
  },

  // looks up one specific user's socket in the room
  getSocket(roomToken: string, pubKeyHash: string): WSContext | undefined {
    return rooms.get(roomToken)?.get(pubKeyHash);
  },

  // gets all active sockets in a room
  getRoomSockets(roomToken: string): WSContext[] {
    const room = rooms.get(roomToken);
    return room ? Array.from(room.values()) : [];
  },

  // returns how many users are in this room on THIS server node
  getRoomSize(roomToken: string): number {
    return rooms.get(roomToken)?.size ?? 0;
  },

  // checks if this server node has active sockets for this room
  hasRoom(roomToken: string): boolean {
    return rooms.has(roomToken);
  },

  // wipes all active connections (clean teardown)
  clear(): void {
    rooms.clear();
  },
};
