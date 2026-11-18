import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "../src/db";
import { workerQueue } from "../src/queue";
import { connectRedis } from "../src/redis";
import {
  broadcastToRoom,
  evictOfflineMessage,
  fetchPendingFromDb,
  fetchPendingFromQueue,
  isUserBanned,
  pushMarkDeliveredJob,
  pushTrackMessageJob,
  queueOfflineMessage,
  subscribeToRoom,
  unsubscribeFromRoom,
  type MarkDeliveredJob,
  type TrackMessageJob,
} from "../src/services/messageService";

beforeAll(async () => {
  await connectRedis();
});

describe("Message Service", () => {
  const testRoomToken = `rm_test_${Date.now()}`;
  const testRecipient = `hash_recipient_${Date.now()}`;

  describe("BullMQ Job Producers", () => {
    it("pushes a TRACK_MESSAGE job to the worker queue", async () => {
      const jobPayload: TrackMessageJob = {
        type: "TRACK_MESSAGE",
        roomToken: testRoomToken,
        msgId: 1,
        ciphertextHex: "deadbeef",
        ivHex: "123456789012345678901234",
        recipientHashes: [testRecipient],
        createdAt: Date.now(),
      };

      await pushTrackMessageJob(jobPayload);

      const waitingJobs = await workerQueue.getJobs(["waiting"]);
      const found = waitingJobs.find(
        j =>
          j.name === "TRACK_MESSAGE" &&
          j.data.roomToken === testRoomToken &&
          j.data.msgId === 1
      );

      expect(found).toBeDefined();
      expect(found?.data.ciphertextHex).toBe("deadbeef");
    });

    it("pushes a MARK_DELIVERED job to the worker queue", async () => {
      const ackPayload: MarkDeliveredJob = {
        type: "MARK_DELIVERED",
        roomToken: testRoomToken,
        msgId: 1,
        recipientHash: testRecipient,
        deliveredAt: Date.now(),
      };

      await pushMarkDeliveredJob(ackPayload);

      const waitingJobs = await workerQueue.getJobs(["waiting"]);
      const found = waitingJobs.find(
        j =>
          j.name === "MARK_DELIVERED" &&
          j.data.roomToken === testRoomToken &&
          j.data.recipientHash === testRecipient
      );

      expect(found).toBeDefined();
      expect(found?.data.msgId).toBe(1);
    });
  });

  describe("Real-Time Fan-Out (Pub/Sub)", () => {
    it("publishes and receives raw Uint8Array frames across redis", async () => {
      const pubsubRoom = `rm_pubsub_${Date.now()}`;
      const outgoingFrame = new Uint8Array([0xaa, 0x03, 0x01, 0x02, 0xff]);

      let receivedFrame: Uint8Array | null = null;

      await subscribeToRoom(pubsubRoom, payload => {
        receivedFrame = payload;
      });

      await new Promise(r => setTimeout(r, 50));

      const receiverCount = await broadcastToRoom(pubsubRoom, outgoingFrame);
      expect(receiverCount).toBeGreaterThanOrEqual(1);

      await new Promise(r => setTimeout(r, 100));

      expect(receivedFrame).not.toBeNull();
      expect(new Uint8Array(receivedFrame!)).toEqual(outgoingFrame);

      await unsubscribeFromRoom(pubsubRoom);
    });
  });

  describe("Offline Queue Store (Redis Hash)", () => {
    it("queues offline packets, allows non-destructive catch-up, and evicts on ACK", async () => {
      const offlineUser = `user_offline_${Date.now()}`;
      const frame1 = new Uint8Array([0xaa, 0x03, 101]);
      const frame2 = new Uint8Array([0xaa, 0x03, 102]);

      await queueOfflineMessage({
        pubKeyHash: offlineUser,
        roomToken: testRoomToken,
        msgId: 101,
        payload: frame1,
      });

      await queueOfflineMessage({
        pubKeyHash: offlineUser,
        roomToken: testRoomToken,
        msgId: 102,
        payload: frame2,
      });

      const backlog1 = await fetchPendingFromQueue(offlineUser);
      expect(backlog1.length).toBe(2);

      const backlog2 = await fetchPendingFromQueue(offlineUser);
      expect(backlog2.length).toBe(2);

      await evictOfflineMessage({
        pubKeyHash: offlineUser,
        roomToken: testRoomToken,
        msgId: 101,
      });

      const backlogAfterAck = await fetchPendingFromQueue(offlineUser);
      expect(backlogAfterAck.length).toBe(1);

      await evictOfflineMessage({
        pubKeyHash: offlineUser,
        roomToken: testRoomToken,
        msgId: 102,
      });

      const backlogEmpty = await fetchPendingFromQueue(offlineUser);
      expect(backlogEmpty.length).toBe(0);
    });
  });

  describe("Inline Database Reads", () => {
    describe("isUserBanned", () => {
      it("returns false for non-banned identity", async () => {
        const banned = await isUserBanned(`safe_user_${Date.now()}`);
        expect(banned).toBe(false);
      });

      it("returns true for an actively banned identity and false after ban expires", async () => {
        const activeBannedUser = `banned_user_${Date.now()}`;
        const expiredBannedUser = `expired_user_${Date.now()}`;

        await db`
          INSERT INTO active_bans (identity_hash, reason, expires_at)
          VALUES (${activeBannedUser}, 'Spamming', NOW() + INTERVAL '1 hour')
        `;

        await db`
          INSERT INTO active_bans (identity_hash, reason, expires_at)
          VALUES (${expiredBannedUser}, 'Old ban', NOW() - INTERVAL '1 hour')
        `;

        expect(await isUserBanned(activeBannedUser)).toBe(true);
        expect(await isUserBanned(expiredBannedUser)).toBe(false);

        await db`DELETE FROM active_bans WHERE identity_hash IN (${activeBannedUser}, ${expiredBannedUser})`;
      });
    });

    describe("fetchPendingFromDb", () => {
      it("retrieves pending unread messages for alive rooms and ignores expired rooms/delivered messages", async () => {
        const testUser = `catchup_user_${Date.now()}`;
        const activeRoom = `rm_alive_${Date.now()}`;
        const expiredRoom = `rm_expired_${Date.now()}`;

        await db`
          INSERT INTO rooms (token, expires_at)
          VALUES 
            (${activeRoom}, NOW() + INTERVAL '1 hour'),
            (${expiredRoom}, NOW() - INTERVAL '1 hour')
        `;

        const cipherA = Buffer.from("cipher_message_1", "utf-8");
        const ivA = Buffer.from("iv_message_1___", "utf-8");
        const cipherB = Buffer.from("cipher_message_2", "utf-8");
        const ivB = Buffer.from("iv_message_2___", "utf-8");
        const cipherExpired = Buffer.from("cipher_expired", "utf-8");
        const ivExpired = Buffer.from("iv_expired_____", "utf-8");

        await db`
          INSERT INTO room_messages (room_token, message_id, ciphertext, iv)
          VALUES 
            (${activeRoom}, 1, ${cipherA}, ${ivA}),
            (${activeRoom}, 2, ${cipherB}, ${ivB}),
            (${expiredRoom}, 1, ${cipherExpired}, ${ivExpired})
        `;

        await db`
          INSERT INTO delivery_receipts (room_token, recipient_hash, message_id, status)
          VALUES 
            (${activeRoom}, ${testUser}, 1, 'PENDING'),
            (${activeRoom}, ${testUser}, 2, 'DELIVERED'),
            (${expiredRoom}, ${testUser}, 1, 'PENDING')
        `;

        const pending = await fetchPendingFromDb(testUser);

        expect(pending.length).toBe(1);
        expect(pending[0]?.room_token).toBe(activeRoom);
        expect(pending[0]?.message_id).toBe(1);
        expect(pending[0]?.ciphertext.toString()).toBe("cipher_message_1");

        await db`DELETE FROM rooms WHERE token IN (${activeRoom}, ${expiredRoom})`;
      });
    });
  });
});
