// tells who is present in the room right now
// auto-expires at TTL, no cleanup needed

// usecases
// green/grey dot on the ui
// if user online -> live message delivery
// else -> push to offline queue, store for 10m, deliever on reconnect
import type { RedisClientType } from "redis";
import { RedisKeys } from "./keys";
import type { RoomMemberKey } from "./rooms";

const PRESENCE_LEASE_TTL_SECONDS = 20;

// create the presence store
export function createPresenceStore(redis: RedisClientType) {
  // set presence when user is online
  async function setPresence({ roomToken, pubKeyHash }: RoomMemberKey) {
    const key = RedisKeys.presence(roomToken, pubKeyHash);
    await redis.set(key, "1", {
      expiration: { type: "EX", value: PRESENCE_LEASE_TTL_SECONDS },
    });
  }

  // called every 10s to while ws is open to keep the 20s lease alive
  async function heartbeat({ roomToken, pubKeyHash }: RoomMemberKey) {
    const key = RedisKeys.presence(roomToken, pubKeyHash);
    await redis.set(key, "1", {
      expiration: { type: "EX", value: PRESENCE_LEASE_TTL_SECONDS },
    });
  }

  // remove presence if user offline, ws close
  async function removePresence({ roomToken, pubKeyHash }: RoomMemberKey) {
    const key = RedisKeys.presence(roomToken, pubKeyHash);
    await redis.del(key);
  }

  // check if user is online
  async function isPresent({
    roomToken,
    pubKeyHash,
  }: RoomMemberKey): Promise<boolean> {
    const key = RedisKeys.presence(roomToken, pubKeyHash);
    const value = await redis.get(key);
    if (!value) return false;
    return value === "1";
  }

  // get all the online members
  async function getOnlineMembers(roomToken: string): Promise<string[]> {
    const pattern = `toku:presence:${roomToken}:*`;
    const hashes: string[] = [];

    // initialize the SCAN iterator
    const iterator = redis.scanIterator({
      MATCH: pattern,
      COUNT: 100, // fetches in batches
    });

    for await (const keys of iterator) {
      for (const key of keys) {
        const value = await redis.get(key);
        if (!value || value !== "1") continue;
        const hash = key.split(":").at(-1)!;
        hashes.push(hash);
      }
    }

    return hashes;
  }

  return {
    setPresence,
    heartbeat,
    removePresence,
    isPresent,
    getOnlineMembers,
  };
}
