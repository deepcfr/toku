import { createPresenceStore, type RoomMemberKey } from "@toku/redis";
import { redis } from "../redis";

// initialize the presence store
const presenceStore = createPresenceStore(redis.client);

// marks a user as active in a room upon initial connection, sets the 20s active lease in redis
export async function setUserOnline(input: RoomMemberKey) {
  await presenceStore.setPresence(input);
}

// renews the 20s lease, triggered periodically
export async function refreshHeartbeat(input: RoomMemberKey) {
  await presenceStore.heartbeat(input);
}

// cleanly marks a user offline on explicit exit or socket close
export async function setUserOffline(input: RoomMemberKey) {
  await presenceStore.removePresence(input);
}

// check if a user is online
export async function isUserOnline(input: RoomMemberKey) {
  return await presenceStore.isPresent(input);
}

// scans and returns all active pubKeyHash strings currently online in a room
export async function getAllOnlineMembers(roomToken: string) {
  return await presenceStore.getOnlineMembers(roomToken);
}
