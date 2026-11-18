import {
  subscribeToRoom,
  unsubscribeFromRoom,
} from "../services/messageService";
import { connectionRegistry } from "./registry";

// flush down redis pubsub payload to local sockets
export function dispatchToLocalRoom(
  roomToken: string,
  payload: Uint8Array
): void {
  const sockets = connectionRegistry.getRoomSockets(roomToken);

  for (const socket of sockets) {
    socket.send(payload as Uint8Array<ArrayBuffer>);
  }
}

// starts listening to redis pub/sub when the first user joins this room on this server
export async function startFanout(roomToken: string): Promise<void> {
  await subscribeToRoom(roomToken, payload => {
    dispatchToLocalRoom(roomToken, payload);
  });
}

// stops listening to redis pub/sub when the last user leaves this room on this server
export async function stopFanout(roomToken: string): Promise<void> {
  await unsubscribeFromRoom(roomToken);
}
