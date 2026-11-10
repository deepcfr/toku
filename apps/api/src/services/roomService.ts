import { randomToken, timingSafeEqual } from "@toku/crypto";
import type { RoomRow } from "@toku/db";
import {
  createRoomStore,
  type AddRoomMemberInput,
  type RoomMemberKey,
} from "@toku/redis";
import { db } from "../db";
import { GoneError, NotFoundError, UnauthorizedError } from "../lib/errors";
import { redis } from "../redis";
import type { CreateRoomBody } from "../schemas/roomSchema";

export interface PublicRoomMetadata {
  token: string;
  memberCount: number;
  maxParticipants: number;
  remainingSeconds: number;
  isDm: boolean;
  createdAt: number;
  expiresAt: number;
}

// create the room store
const roomStore = createRoomStore(redis.client);

// create room
export async function createRoom(
  input: CreateRoomBody
): Promise<PublicRoomMetadata> {
  const isDm = input.isDm ?? false;
  const token = randomToken(isDm ? "dm_" : "rm_");
  const now = Date.now();
  const expiresAt = now + input.durationSeconds * 1000;
  const maxParticipants = input.maxParticipants ?? (isDm ? 2 : 16);

  // insert into db
  await db`
    INSERT INTO rooms (token, created_at, expires_at)
    VALUES (${token}, ${new Date(now)}, ${new Date(expiresAt)})
  `;

  // store in redis cache with ttl
  await roomStore.createRoom({
    roomToken: token,
    passwordHash: input.passwordHash,
    durationSeconds: input.durationSeconds,
    isDm,
    maxParticipants,
  });

  return {
    token,
    memberCount: 0,
    maxParticipants,
    remainingSeconds: input.durationSeconds,
    isDm,
    createdAt: now,
    expiresAt,
  };
}

// get room metadata
export async function getRoomMetadata(
  token: string
): Promise<PublicRoomMetadata> {
  // check from redis first, then postgres
  // if its expired in postgres throw error
  const cached = await roomStore.getRoom(token);

  if (cached) {
    const expiresAt = cached.createdAt + cached.lifetimeSeconds * 1000;
    return {
      token,
      memberCount: cached.memberCount,
      maxParticipants: cached.maxParticipants,
      remainingSeconds: cached.remainingSeconds,
      isDm: cached.isDm,
      createdAt: cached.createdAt,
      expiresAt,
    };
  }

  const [row] = await db<RoomRow[]>`
    SELECT token, created_at, expires_at
    FROM rooms
    WHERE token = ${token}
  `;

  if (!row) throw new NotFoundError("Room not found");

  const now = Date.now();
  const expiresAt = row.expires_at.getTime();
  if (expiresAt <= now) throw new GoneError("Room has expired");

  const remainingSeconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const isDm = token.startsWith("dm_");

  return {
    token: row.token,
    memberCount: 0,
    maxParticipants: isDm ? 2 : 16,
    remainingSeconds,
    isDm,
    createdAt: row.created_at.getTime(),
    expiresAt,
  };
}

// verify the passwordHash
export async function verifyPassword(
  token: string,
  clientPasswordProof: string
): Promise<boolean> {
  const cached = await roomStore.getRoom(token);
  if (!cached) throw new NotFoundError("Room not found");

  const encoder = new TextEncoder();
  const storedBytes = encoder.encode(cached.passwordHash);
  const clientBytes = encoder.encode(clientPasswordProof);

  const isValid = timingSafeEqual(storedBytes, clientBytes);
  if (!isValid) throw new UnauthorizedError("Invalid room password proof");

  return true;
}

// delete room and all its related data
export async function purgeRoom(token: string): Promise<void> {
  await roomStore.deleteRoom(token);
  await db`
    DELETE FROM rooms WHERE token = ${token}
  `;
}

// add member to active member set & keyring (used when binary JOIN_ROOM frame arrives)
export async function addMemberToRoom(
  input: AddRoomMemberInput
): Promise<void> {
  return roomStore.addMember(input);
}

// remove member when socket closes or disconnects
export async function removeMemberFromRoom(
  input: RoomMemberKey
): Promise<void> {
  return roomStore.removeMember(input);
}

// fast O(1) membership check
export async function isRoomMember(input: RoomMemberKey): Promise<boolean> {
  return roomStore.isMember(input);
}

// fetch all public keys in the room for end-to-end encryption
export async function getRoomPublicKeys(
  roomToken: string
): Promise<Record<string, string>> {
  return roomStore.getAllPublicKeys(roomToken);
}
