import { db } from "../db";
import { logger } from "../logger";

export interface CleanupStats {
  roomsDeleted: number;
  bansCleared: number;
  newBansApplied: number;
  incidentLogsPurged: number;
}

export async function processCleanup(): Promise<CleanupStats> {
  // Cascade delete all expired rooms (also cascades room_messages & delivery_receipts)
  const expiredRooms = await db`
    DELETE FROM rooms
    WHERE expires_at <= NOW()
    RETURNING token
  `;

  // Remove expired bans from active_bans
  const expiredBans = await db`
    DELETE FROM active_bans
    WHERE expires_at <= NOW()
    RETURNING identity_hash
  `;

  // Promote abusive identities with frequent incidents into active_bans
  const newBans = await db`
    INSERT INTO active_bans (identity_hash, reason, expires_at)
    SELECT
      identity_hash,
      'Automated rate limit / protocol violation ban' AS reason,
      NOW() + INTERVAL '1 hour' AS expires_at
    FROM security_incident_log
    WHERE occurred_at >= NOW() - INTERVAL '1 minute'
    GROUP BY identity_hash
    HAVING COUNT(*) >= 5
    ON CONFLICT (identity_hash) DO UPDATE
    SET expires_at = EXCLUDED.expires_at, reason = EXCLUDED.reason
    RETURNING identity_hash
  `;

  // Prune stale incident logs to keep the table lean
  const purgedLogs = await db`
    DELETE FROM security_incident_log
    WHERE occurred_at < NOW() - INTERVAL '24 hours'
    RETURNING id
  `;

  const stats: CleanupStats = {
    roomsDeleted: expiredRooms.length,
    bansCleared: expiredBans.length,
    newBansApplied: newBans.length,
    incidentLogsPurged: purgedLogs.length,
  };

  logger.info(stats, "Completed background sweep cycle");
  return stats;
}
