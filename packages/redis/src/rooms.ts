import type { RedisClientType } from "redis";
import { RedisKeys } from "./keys";

// all types
export interface CreateRoomInput {
  roomToken: string;
  passwordHash: string;
  durationSeconds: number; // dynamic room TTL
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
  lifetimeSeconds: number;
}

// Redis hash fields use snake_case by convention, it gives autocomplete for hSet/hGetAll
export type RoomHashFields = Record<string, string> & {
  created_at: string;
  member_count: string;
  password_hash: string;
  lifetime_seconds: string;
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

  // initialize room metadata with caller-provided lifetime
  async function createRoom({
    roomToken,
    passwordHash,
    durationSeconds,
  }: CreateRoomInput) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);
    const now = Date.now();

    const hash: RoomHashFields = {
      created_at: String(now),
      member_count: "0",
      password_hash: passwordHash,
      lifetime_seconds: String(durationSeconds),
    };

    // use MULTI/EXEC for handling race condition
    // synchronize TTL across all three keys to prevent orphaned memory leaks
    await redis
      .multi()
      .hSet(roomKey, hash)
      .expire(roomKey, durationSeconds)
      .expire(membersKey, durationSeconds)
      .expire(keyringKey, durationSeconds)
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
      lifetimeSeconds: Number(data.lifetime_seconds ?? 86400),
    };
  }

  // add a member in the room
  async function addMember({
    roomToken,
    pubKeyHash,
    publicKeyBytes,
  }: AddRoomMemberInput) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);

    // check the exact remaining seconds left on the core room bucket
    const remainingTtl = await redis.ttl(roomKey);

    // doesnt have an expiry or already dead
    if (remainingTtl <= 0) return;

    // atomically joins a member
    await redis
      .multi()
      .sAdd(membersKey, pubKeyHash)
      .hIncrBy(roomKey, "member_count", 1)
      .hSet(keyringKey, pubKeyHash, publicKeyBytes)
      .expire(roomKey, remainingTtl)
      .expire(membersKey, remainingTtl)
      .expire(keyringKey, remainingTtl)
      .exec();
  }

  // remove member atomically
  async function removeMember({ roomToken, pubKeyHash }: RoomMemberKey) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);

    const remainingTtl = await redis.ttl(roomKey);
    if (remainingTtl <= 0) return;

    await redis
      .multi()
      .sRem(membersKey, pubKeyHash)
      .hIncrBy(roomKey, "member_count", -1)
      .hDel(keyringKey, pubKeyHash)
      .expire(roomKey, remainingTtl)
      .expire(membersKey, remainingTtl)
      .expire(keyringKey, remainingTtl)
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

  return {
    createRoom,
    getRoom,
    addMember,
    removeMember,
    isMember,
    getAllPublicKeys,
  };
}
