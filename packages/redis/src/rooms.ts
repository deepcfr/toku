import type { RedisClientType } from "redis";
import { RedisKeys } from "./keys";

// default room TTL = 24 hours
const ROOM_TTL_SECONDS = 86400;

// all types
export interface CreateRoomInput {
  roomToken: string;
  passwordHash?: string;
}

export interface RoomMemberKey {
  roomToken: string;
  pubKeyHash: string;
}

export interface AddRoomMemberInput extends RoomMemberKey {
  publicKeyBytes: string;
}

export interface RoomMetadata {
  createdAt: number;
  memberCount: number;
  passwordHash: string;
  lastActivity: number;
}

// Redis hash fields use snake_case by convention, it gives autocomplete for hSet/hGetAll
export type RoomHashFields = Record<string, string> & {
  created_at: string;
  member_count: string;
  password_hash: string;
  last_activity: string;
};

// create room store
export function createRoomStore(redis: RedisClientType) {
  function getKeys(roomToken: string) {
    return {
      roomKey: RedisKeys.room(roomToken),
      membersKey: RedisKeys.roomMembers(roomToken),
      keyringKey: RedisKeys.roomKeys(roomToken),
    };
  }

  // initialize room metadata and set 24h ttl
  async function createRoom({ roomToken, passwordHash }: CreateRoomInput) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);
    const now = Date.now();

    const hash: RoomHashFields = {
      created_at: String(now),
      member_count: "0",
      password_hash: passwordHash ?? "",
      last_activity: String(now),
    };

    // use MULTI/EXEC for handling race condition
    // synchronize TTL across all three keys to prevent orphaned memory leaks
    await redis
      .multi()
      .hSet(roomKey, hash)
      .expire(roomKey, ROOM_TTL_SECONDS)
      .expire(membersKey, ROOM_TTL_SECONDS)
      .expire(keyringKey, ROOM_TTL_SECONDS)
      .exec();
  }

  // return room metadata — hGetAll returns Record<string,string> so we cast to RoomHashFields for suggestions
  async function getRoom(roomToken: string): Promise<RoomMetadata | null> {
    const roomKey = RedisKeys.room(roomToken);
    const data = (await redis.hGetAll(roomKey)) as Partial<RoomHashFields>;

    if (!data || Object.keys(data).length === 0) return null;

    return {
      createdAt: Number(data.created_at ?? 0),
      memberCount: Number(data.member_count ?? 0),
      passwordHash: data.password_hash ?? "",
      lastActivity: Number(data.last_activity ?? 0),
    };
  }

  // add a member in the room
  async function addMember({
    roomToken,
    pubKeyHash,
    publicKeyBytes,
  }: AddRoomMemberInput) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);
    const now = Date.now();

    // atomically joins a member
    await redis
      .multi()
      .sAdd(membersKey, pubKeyHash)
      .hIncrBy(roomKey, "member_count", 1)
      .hSet(keyringKey, pubKeyHash, publicKeyBytes)
      .hSet(roomKey, "last_activity", String(now))
      .expire(roomKey, ROOM_TTL_SECONDS)
      .expire(membersKey, ROOM_TTL_SECONDS)
      .expire(keyringKey, ROOM_TTL_SECONDS)
      .exec();
  }

  // remove member atomically
  async function removeMember({ roomToken, pubKeyHash }: RoomMemberKey) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);

    await redis
      .multi()
      .sRem(membersKey, pubKeyHash)
      .hIncrBy(roomKey, "member_count", -1)
      .hDel(keyringKey, pubKeyHash)
      .hSet(roomKey, "last_activity", String(Date.now()))
      .expire(roomKey, ROOM_TTL_SECONDS)
      .expire(membersKey, ROOM_TTL_SECONDS)
      .expire(keyringKey, ROOM_TTL_SECONDS)
      .exec();
  }

  // fast O(1) check
  async function isMember({
    roomToken,
    pubKeyHash,
  }: RoomMemberKey): Promise<boolean> {
    const { membersKey } = getKeys(roomToken);
    return (await redis.sIsMember(membersKey, pubKeyHash)) === 1;
  }

  // fetches all participants' public keys for pairwise X3DH derivation
  async function getAllPublicKeys(
    roomToken: string
  ): Promise<Record<string, string>> {
    const { keyringKey } = getKeys(roomToken);
    return await redis.hGetAll(keyringKey);
  }

  // refreshes room TTL on message activity
  async function touch(roomToken: string): Promise<void> {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);
    const now = Date.now();

    await redis
      .multi()
      .hSet(roomKey, "last_activity", String(now))
      .expire(roomKey, ROOM_TTL_SECONDS)
      .expire(membersKey, ROOM_TTL_SECONDS)
      .expire(keyringKey, ROOM_TTL_SECONDS)
      .exec();
  }

  return {
    createRoom,
    getRoom,
    addMember,
    removeMember,
    isMember,
    getAllPublicKeys,
    touch,
  };
}
