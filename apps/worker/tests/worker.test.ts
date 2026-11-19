import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "../src/db";
import { processCleanup } from "../src/processors/cleanerProcessor";
import {
  processMarkDelivered,
  processTrackMessage,
} from "../src/processors/messageProcessor";
import {
  WORKER_QUEUE_NAME,
  type MarkDeliveredJob,
  type TrackMessageJob,
} from "../src/types";
import { createTokuWorker } from "../src/worker";

describe("Worker Subsystem (@toku/worker)", () => {
  let isDbAvailable = false;

  beforeAll(async () => {
    try {
      await db`SELECT 1`;
      isDbAvailable = true;
    } catch {
      isDbAvailable = false;
    }
  });

  describe("Worker Factory", () => {
    it("creates a BullMQ Worker instance bound to toku-worker queue", () => {
      const worker = createTokuWorker(5);
      expect(worker.name).toBe(WORKER_QUEUE_NAME);
      expect(worker.opts.concurrency).toBe(5);
      // Close worker immediately to free connection
      void worker.close();
    });
  });

  describe("Message Processors (PostgreSQL Integration)", () => {
    const testRoomToken = `rm_worker_${Date.now()}`;
    const testRecipient = `rcp_hash_${Date.now()}`;
    const testMsgId = 42;

    it("gracefully discards track message if room does not exist (FK 23503)", async () => {
      if (!isDbAvailable) return;

      const job: TrackMessageJob = {
        type: "TRACK_MESSAGE",
        roomToken: "non_existent_room_9999",
        msgId: 1,
        ciphertextHex: "aabbccdd",
        ivHex: "112233445566778899001122",
        recipientHashes: [testRecipient],
        createdAt: Date.now(),
      };

      // Should not throw even though foreign key fails
      await expect(processTrackMessage(job)).resolves.toBeUndefined();
    });

    it("inserts room_messages and delivery_receipts rows for an active room", async () => {
      if (!isDbAvailable) return;

      // Seed room
      const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
      await db`
        INSERT INTO rooms (token, expires_at)
        VALUES (${testRoomToken}, ${futureExpiry})
      `;

      const createdAt = Date.now();
      const job: TrackMessageJob = {
        type: "TRACK_MESSAGE",
        roomToken: testRoomToken,
        msgId: testMsgId,
        ciphertextHex: "cafebabe",
        ivHex: "123456789012345678901234",
        recipientHashes: [testRecipient],
        createdAt,
      };

      await processTrackMessage(job);

      // Verify room_messages row
      const messages = await db`
        SELECT * FROM room_messages
        WHERE room_token = ${testRoomToken} AND message_id = ${testMsgId}
      `;
      expect(messages.length).toBe(1);
      expect((messages[0]?.ciphertext as Buffer).toString("hex")).toBe(
        "cafebabe"
      );

      // Verify delivery_receipts row
      const receipts = await db`
        SELECT * FROM delivery_receipts
        WHERE room_token = ${testRoomToken}
          AND message_id = ${testMsgId}
          AND recipient_hash = ${testRecipient}
      `;
      expect(receipts.length).toBe(1);
      expect(receipts[0]?.status).toBe("PENDING");
      expect(receipts[0]?.delivered_at).toBeNull();
    });

    it("updates delivery_receipt status and delivered_at upon MARK_DELIVERED", async () => {
      if (!isDbAvailable) return;

      const deliveredAt = Date.now();
      const markJob: MarkDeliveredJob = {
        type: "MARK_DELIVERED",
        roomToken: testRoomToken,
        msgId: testMsgId,
        recipientHash: testRecipient,
        deliveredAt,
      };

      await processMarkDelivered(markJob);

      const receipts = await db`
        SELECT * FROM delivery_receipts
        WHERE room_token = ${testRoomToken}
          AND message_id = ${testMsgId}
          AND recipient_hash = ${testRecipient}
      `;
      expect(receipts.length).toBe(1);
      expect(receipts[0]?.status).toBe("DELIVERED");
      expect(receipts[0]?.delivered_at).toBeDefined();
    });

    it("handles idempotent duplicate TRACK_MESSAGE without error", async () => {
      if (!isDbAvailable) return;

      const duplicateJob: TrackMessageJob = {
        type: "TRACK_MESSAGE",
        roomToken: testRoomToken,
        msgId: testMsgId,
        ciphertextHex: "cafebabe",
        ivHex: "123456789012345678901234",
        recipientHashes: [],
        createdAt: Date.now(),
      };

      await expect(processTrackMessage(duplicateJob)).resolves.toBeUndefined();
    });
  });

  describe("Cleaner & Security Incident Sweeper", () => {
    it("cascades expired rooms and removes expired bans", async () => {
      if (!isDbAvailable) return;

      const expiredToken = `rm_expired_${Date.now()}`;
      const pastTime = new Date(Date.now() - 10000);

      // Seed expired room
      await db`
        INSERT INTO rooms (token, expires_at)
        VALUES (${expiredToken}, ${pastTime})
      `;

      // Seed expired ban
      const bannedUser = `banned_${Date.now()}`;
      await db`
        INSERT INTO active_bans (identity_hash, reason, expires_at)
        VALUES (${bannedUser}, 'test ban', ${pastTime})
      `;

      const stats = await processCleanup();

      expect(stats.roomsDeleted).toBeGreaterThanOrEqual(1);
      expect(stats.bansCleared).toBeGreaterThanOrEqual(1);

      // Verify room was wiped
      const roomCheck =
        await db`SELECT * FROM rooms WHERE token = ${expiredToken}`;
      expect(roomCheck.length).toBe(0);

      // Verify ban was wiped
      const banCheck =
        await db`SELECT * FROM active_bans WHERE identity_hash = ${bannedUser}`;
      expect(banCheck.length).toBe(0);
    });

    it("auto-bans identity with >= 5 security incidents within 60 seconds", async () => {
      if (!isDbAvailable) return;

      const abusiveIdentity = `spammer_${Date.now()}`;

      // Insert security incidents for test threshold
      for (let i = 0; i < 5; i++) {
        await db`
          INSERT INTO security_incident_log (identity_hash, incident_type)
          VALUES (${abusiveIdentity}, 'MALFORMED_FRAME')
        `;
      }

      const stats = await processCleanup();
      expect(stats.newBansApplied).toBeGreaterThanOrEqual(1);

      // Verify identity was added to active_bans
      const banRows = await db`
        SELECT * FROM active_bans
        WHERE identity_hash = ${abusiveIdentity}
      `;
      expect(banRows.length).toBe(1);

      // Cleanup
      await db`DELETE FROM active_bans WHERE identity_hash = ${abusiveIdentity}`;
      await db`DELETE FROM security_incident_log WHERE identity_hash = ${abusiveIdentity}`;
    });
  });

  afterAll(async () => {
    // Teardown test rooms
    if (isDbAvailable) {
      await db`DELETE FROM rooms WHERE token LIKE 'rm_worker_%'`;
    }
  });
});
