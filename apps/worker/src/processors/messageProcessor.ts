import { db } from "../db";
import { logger } from "../logger";
import type { MarkDeliveredJob, TrackMessageJob } from "../types";

export async function processTrackMessage(job: TrackMessageJob): Promise<void> {
  const ciphertext = Buffer.from(job.ciphertextHex, "hex");
  const iv = Buffer.from(job.ivHex, "hex");
  const createdAt = new Date(job.createdAt);

  try {
    await db.begin(async sql => {
      await sql`
        INSERT INTO room_messages (room_token, message_id, ciphertext, iv, created_at)
        VALUES (
          ${job.roomToken},
          ${job.msgId},
          ${ciphertext},
          ${iv},
          ${createdAt}
        )
        ON CONFLICT (room_token, message_id) DO NOTHING
      `;

      if (job.recipientHashes.length > 0) {
        const rows = job.recipientHashes.map(recipientHash => ({
          room_token: job.roomToken,
          recipient_hash: recipientHash,
          message_id: job.msgId,
          status: "PENDING" as const,
          attempted_at: createdAt,
        }));

        await sql`
          INSERT INTO delivery_receipts ${sql(
            rows,
            "room_token",
            "recipient_hash",
            "message_id",
            "status",
            "attempted_at"
          )}
        `;
      }
    });

    logger.debug(
      {
        roomToken: job.roomToken,
        msgId: job.msgId,
        recipients: job.recipientHashes.length,
      },
      "Tracked message and delivery receipts in database"
    );
  } catch (err: unknown) {
    // PostgreSQL foreign key violation error code
    // If the room was already deleted or expired, gracefully discard the job
    if ((err as { code?: string }).code === "23503") {
      logger.debug(
        { roomToken: job.roomToken, msgId: job.msgId },
        "Room or message no longer exists; dropped track message job"
      );
      return;
    }
    throw err;
  }
}

export async function processMarkDelivered(
  job: MarkDeliveredJob
): Promise<void> {
  const deliveredAt = new Date(job.deliveredAt);

  const updated = await db`
    UPDATE delivery_receipts
    SET status = 'DELIVERED', delivered_at = ${deliveredAt}
    WHERE room_token = ${job.roomToken}
      AND message_id = ${job.msgId}
      AND recipient_hash = ${job.recipientHash}
      AND delivered_at IS NULL
    RETURNING id
  `;

  logger.debug(
    {
      roomToken: job.roomToken,
      msgId: job.msgId,
      recipientHash: job.recipientHash,
      rowsUpdated: updated.length,
    },
    "Updated delivery receipt status"
  );
}
