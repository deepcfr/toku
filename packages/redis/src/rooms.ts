import type { RedisClientType } from "redis";
import { RedisKeys } from "./keys";

// all types
export interface CreateRoomInput {
  roomToken: string;
  passwordHash: string;
  creatorKeyHash: string;
  durationSeconds: number; // dynamic room TTL
  maxParticipants?: number;
  isDm?: boolean;
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
  creatorKeyHash: string;
  lifetimeSeconds: number;
  maxParticipants: number;
  isDm: boolean;
  remainingSeconds: number;
}

// Redis hash fields use snake_case by convention, it gives autocomplete for hSet/hGetAll
export type RoomHashFields = Record<string, string> & {
  created_at: string;
  member_count: string;
  password_hash: string;
  creator_key_hash: string;
  lifetime_seconds: string;
  max_participants: string;
  is_dm: string;
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
    creatorKeyHash,
    durationSeconds,
    maxParticipants,
    isDm = false,
  }: CreateRoomInput) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);
    const now = Date.now();
    const capacity = maxParticipants ?? (isDm ? 2 : 16);

    const hash: RoomHashFields = {
      created_at: String(now),
      member_count: "0",
      password_hash: passwordHash,
      creator_key_hash: creatorKeyHash,
      lifetime_seconds: String(durationSeconds),
      max_participants: String(capacity),
      is_dm: isDm ? "1" : "0",
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
    const [data, remainingSeconds] = await Promise.all([
      redis.hGetAll(roomKey) as Promise<Partial<RoomHashFields>>,
      redis.ttl(roomKey),
    ]);

    if (!data || Object.keys(data).length === 0 || remainingSeconds <= 0)
      return null;

    return {
      createdAt: Number(data.created_at ?? 0),
      memberCount: Number(data.member_count ?? 0),
      passwordHash: data.password_hash ?? "",
      creatorKeyHash: data.creator_key_hash ?? "",
      lifetimeSeconds: Number(data.lifetime_seconds ?? 86400),
      maxParticipants: Number(data.max_participants ?? 16),
      isDm: data.is_dm === "1",
      remainingSeconds,
    };
  }

  // atomically deletes all the keys for a room
  async function deleteRoom(roomToken: string) {
    const { roomKey, membersKey, keyringKey } = getKeys(roomToken);
    await redis.del([roomKey, membersKey, keyringKey]);
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
    deleteRoom,
    addMember,
    removeMember,
    isMember,
    getAllPublicKeys,
  };
}
