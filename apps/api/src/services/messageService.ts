import type {
  MarkDeliveredJob,
  RoomMessageRow,
  TrackMessageJob,
  WorkerJob,
} from "@toku/db";
import {
  createOfflineQueueStore,
  createPubSubStore,
  type BaseOfflineQueue,
  type Enqueue,
  type PubSubHandler,
} from "@toku/redis";
import { db } from "../db";
import { workerQueue } from "../queue";
import { redis } from "../redis";

export type { TrackMessageJob, MarkDeliveredJob, WorkerJob };

// initialize the stores
const pubSubStore = createPubSubStore(redis.pub, redis.sub);
const offlineQueueStore = createOfflineQueueStore(redis.client);

// push the jobs in the workerQueue
export async function pushTrackMessageJob(job: TrackMessageJob) {
  await workerQueue.add(job.type, job);
}

export async function pushMarkDeliveredJob(job: MarkDeliveredJob) {
  await workerQueue.add(job.type, job);
}

// handle real-time live fan-out
export async function broadcastToRoom(roomToken: string, payload: Uint8Array) {
  return await pubSubStore.publish(roomToken, payload);
}

export async function subscribeToRoom(
  roomToken: string,
  handler: PubSubHandler
) {
  await pubSubStore.subscribe(roomToken, handler);
}

export async function unsubscribeFromRoom(roomToken: string) {
  await pubSubStore.unsubscribe(roomToken);
}

// handle the offline-queue
export async function queueOfflineMessage(input: Enqueue) {
  await offlineQueueStore.enqueue(input);
}

export async function fetchPendingFromQueue(pubKeyHash: string) {
  return await offlineQueueStore.fetchBackLog(pubKeyHash);
}

export async function evictOfflineMessage(input: BaseOfflineQueue) {
  await offlineQueueStore.evict(input);
}

// inline database reads
// check if a user is banned
export async function isUserBanned(identityHash: string) {
  const [row] = await db<{ identity_hash: string }[]>`
        SELECT identity_hash 
        FROM active_bans
        WHERE identity_hash = ${identityHash}
            AND expires_at > NOW()
        LIMIT 1
    `;

  return row !== undefined;
}

// fetch the messages from db if not present in the offline queue
export async function fetchPendingFromDb(pubKeyHash: string) {
  return await db<RoomMessageRow[]>`
        SELECT
            m.room_token,
            m.message_id,
            m.ciphertext,
            m.iv,
            m.created_at
        FROM delivery_receipts dr
        JOIN room_messages m
            ON m.room_token = dr.room_token
            AND m.message_id = dr.message_id
        JOIN rooms r
            ON r.token = dr.room_token
        WHERE dr.recipient_hash = ${pubKeyHash}
            AND dr.status = 'PENDING'
            AND r.expires_at > NOW()
        ORDER BY m.message_id asc
    `;
}
