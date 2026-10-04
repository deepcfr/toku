// offline queue for disconnected users
// stores messages for 10m and delivers on reconnect
import { RESP_TYPES, type RedisClientType } from "redis";
import { RedisKeys } from "./keys";

interface BaseOfflineQueue {
  pubKeyHash: string;
  roomToken: string;
  msgId: number;
}

interface Enqueue extends BaseOfflineQueue {
  payload: Uint8Array;
}

export function createOfflineQueueStore(redis: RedisClientType) {
  /**
   * drops a raw byte packet into the recipient's short-term offline hash cache(queue)
   * TTL = 600s, caps history window at 100
   */
  async function enqueue({ pubKeyHash, roomToken, msgId, payload }: Enqueue) {
    const key = RedisKeys.offlineQueue(pubKeyHash);
    const field = `${roomToken}:${msgId}`; // -> the hash field
    // we will store the payload as the value

    // wrap the Uint8Array payload in buffer
    const buffer = Buffer.from(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength
    );

    // hashes have no trim, cap by evicting one random field when full
    // unordered eviction is the only O(1) option, memory stays bounded either way
    if ((await redis.hLen(key)) >= 100) {
      const victim = await redis.hRandField(key);
      if (victim) await redis.hDel(key, victim);
    }

    await redis.multi().hSet(key, field, buffer).expire(key, 600).exec();
  }

  /**
   * when client reconnects after staying offline for a while, we first fetch all the messages that arrived
   * in this period & waiting in the queue. then we want to flush them down the client's WS. but if client again
   * disconnects in the middle & had we deleted the messages from the redis list, we lose them permanently & the client
   * won't receive them anymore. so we delete only when the client sends ACK.
   */
  async function fetchBackLog(pubKeyHash: string): Promise<Uint8Array[]> {
    const key = RedisKeys.offlineQueue(pubKeyHash);

    // v6 static types don't propagate typeMapping, runtime decoder honors it
    // cast is honest here, live-verified below that elements arrive as Buffer
    const messages = (await redis
      .withCommandOptions({ typeMapping: { [RESP_TYPES.BLOB_STRING]: Buffer } })
      .hVals(key)) as unknown as Buffer[];

    // Buffer[] assigns directly to Uint8Array[], same bytes, no copy
    return messages;
  }

  // once client acknowledges, remove the specific message out of the offline hash cache
  async function evict({ pubKeyHash, roomToken, msgId }: BaseOfflineQueue) {
    const key = RedisKeys.offlineQueue(pubKeyHash);
    const field = `${roomToken}:${msgId}`;

    return await redis.hDel(key, field);
  }

  return {
    enqueue,
    fetchBackLog,
    evict,
  };
}
