import { bytesToHex, randomToken, sha256, timingSafeEqual } from "@toku/crypto";
import type { RoomRow } from "@toku/db";
import {
  createRoomStore,
  type AddRoomMemberInput,
  type RoomMemberKey,
} from "@toku/redis";
import { db } from "../db";
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
} from "../lib/errors";
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

export interface CreateRoomResult extends PublicRoomMetadata {
  creatorKey: string;
}

export interface VerifyPasswordInput {
  token: string;
  passwordProof: string;
}

export interface PurgeRoomInput {
  token: string;
  creatorKey?: string;
  passwordProof?: string;
}

// create the room store
const roomStore = createRoomStore(redis.client);

// create room
export async function createRoom(
  input: CreateRoomBody
): Promise<CreateRoomResult> {
  const isDm = input.isDm ?? false;
  const token = randomToken(isDm ? "dm_" : "rm_");
  const creatorKey = randomToken("cr_");
  const now = Date.now();
  const expiresAt = now + input.durationSeconds * 1000;
  const maxParticipants = isDm ? 2 : (input.maxParticipants ?? 16);

  // hash the creatorKey before storing into redis
  const creatorKeyHash = bytesToHex(
    await sha256(new TextEncoder().encode(creatorKey))
  );

  // insert into db
  await db`
    INSERT INTO rooms (token, created_at, expires_at)
    VALUES (${token}, ${new Date(now)}, ${new Date(expiresAt)})
  `;

  // store in redis cache with ttl
  await roomStore.createRoom({
    roomToken: token,
    passwordHash: input.passwordHash,
    creatorKeyHash,
    durationSeconds: input.durationSeconds,
    isDm,
    maxParticipants,
  });

  return {
    token,
    creatorKey,
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
  input: VerifyPasswordInput
): Promise<boolean> {
  const cached = await roomStore.getRoom(input.token);
  if (!cached) throw new NotFoundError("Room not found");

  const encoder = new TextEncoder();
  const storedBytes = encoder.encode(cached.passwordHash);
  const clientBytes = encoder.encode(input.passwordProof);

  const isValid = timingSafeEqual(storedBytes, clientBytes);
  if (!isValid) throw new UnauthorizedError("Invalid room password proof");

  return true;
}

// delete room and all its related data
export async function purgeRoom(input: PurgeRoomInput): Promise<void> {
  const cached = await roomStore.getRoom(input.token);
  if (!cached) throw new NotFoundError("Room not found");

  const encoder = new TextEncoder();

  if (cached.isDm) {
    // for 1:1 dm, either the creatorKey or the shared passwordProof can delete for both
    let authorized = false;

    // the creator wants to delete it
    if (input.creatorKey) {
      const inputHash = bytesToHex(
        await sha256(encoder.encode(input.creatorKey))
      );

      if (
        timingSafeEqual(
          encoder.encode(cached.creatorKeyHash),
          encoder.encode(inputHash)
        )
      )
        authorized = true;
    }

    // the other user
    if (!authorized && input.passwordProof) {
      if (
        timingSafeEqual(
          encoder.encode(cached.passwordHash),
          encoder.encode(input.passwordProof)
        )
      )
        authorized = true;
    }

    if (!authorized)
      throw new UnauthorizedError("Invalid creator key or password proof");
  } else {
    // group room -> only the creator can delete the room
    if (!input.creatorKey)
      throw new ForbiddenError("Only the room creator can delete this room");

    const inputHash = bytesToHex(
      await sha256(encoder.encode(input.creatorKey))
    );
    const isValid = timingSafeEqual(
      encoder.encode(cached.creatorKeyHash),
      encoder.encode(inputHash)
    );

    if (!isValid) throw new ForbiddenError("Invalid creator key");
  }

  await roomStore.deleteRoom(input.token);
  await db`
    DELETE FROM rooms WHERE token = ${input.token}
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
