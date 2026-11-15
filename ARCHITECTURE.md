# Master System Architecture Specification: E2EE Real-Time Messaging Engine

## 1. Core Design Philosophy & Constraints

- **Identity Model**: There are no usernames or emails. Every user is identified strictly by their cryptographic `pubKeyHash` (`recipientHash` / `identityHash`).
- **End-to-End Encryption (E2EE)**: The server and database never see plaintext messages or private keys. The backend strictly routes and stores encrypted binary payloads (ciphertext with appended AES-GCM auth tag + 12-byte `iv`).
- **Custom Binary Wire Protocol**: All WebSocket traffic uses raw `Uint8Array` frames parsed via `DataView` with strict bounds checking. No JSON is ever sent over client WebSockets.
- **Ephemeral Rooms**: Rooms have strict, non-extending lifespans (e.g., 15m, 1h, 24h). Activity inside a room never extends its expiration deadline.

---

## 2. The Four Architectural Layers

### Layer A: The Wire & Protocol Layer (`Uint8Array`)

- **Outbound Chat (`CHAT_MESSAGE`)**: Client encrypts text on-device, assigns a sequential 2-byte `msgId` (`Uint16`), and encodes `roomToken`, `from` (`pubKeyHash`), `msgId`, `timestamp` (`BigInt`), `iv`, and `ciphertext` into a `Uint8Array`.
- **Delivery Acknowledgment (`DELIVERY_ACK`)**: When a recipient's device receives and processes a message, it immediately replies with a lightweight binary frame containing `roomToken`, `from` (the recipient's `pubKeyHash`), and `msgId`.
- **Node-Redis Binary Boundary**: `node-redis` types restrict arguments to `Buffer | string`. All store functions accept standard web `Uint8Array` externally and wrap them via zero-copy `Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)` internally. Subscriptions use `returnBuffers: true` to prevent UTF-8 string mangling.

### Layer B: The Real-Time WebSocket Servers (`apps/api`)

Stateless horizontally scaled WebSocket nodes.

1. **Connection Gate (Inline DB Read)**: On socket upgrade, the server runs an inline query against PostgreSQL `active_bans` (`WHERE identity_hash = $1 AND expires_at > NOW()`). Banned identities are rejected immediately.
2. **Ingress Validation Gate**: When a `CHAT_MESSAGE` arrives, Server 1 decodes the header (`roomToken`, `from`, `msgId`) and checks `SISMEMBER toku:room:<roomToken>:members <from>`. Unauthorized senders are dropped immediately.
3. **Recipient Arbitration (Online vs. Offline)**:
   - Server 1 fetches all room members via `SMEMBERS toku:room:<roomToken>:members` and filters out the sender.
   - For each recipient, Server 1 checks `EXISTS toku:presence:<roomToken>:<recipientHash>`.
   - **If Online (Lease exists)**: Do nothing for the offline queue; rely on the live Pub/Sub broadcast.
   - **If Offline (No lease)**: Enqueue the raw `Uint8Array` frame into the recipient's Redis Hash cache (`toku:offline:<recipientHash>`).
4. **Database Offloading**: Server 1 pushes a `TRACK_MESSAGE` job onto the BullMQ / Redis worker queue (`toku:worker:queue`) so the event loop never blocks on disk writes.
5. **Live Fan-Out (Redis Pub/Sub)**: Server 1 publishes the untouched original `Uint8Array` bytes to `toku:channel:<roomToken>`. Subscribed servers (e.g., Server 2) receive the raw buffer without decoding it and flush it straight down matching local WebSockets.
6. **ACK Handling**: When Server 2 receives a `DELIVERY_ACK` frame from a client:
   - It executes an $O(1)$ surgical eviction on Redis: `HDEL toku:offline:<recipientHash> "<roomToken>:<msgId>"`.
   - It pushes a `MARK_DELIVERED` job to the BullMQ worker queue.

### Layer C: The Redis Cache & Transit Layer (`packages/redis`)

- `toku:room:<roomToken>` (**Hash**): Stores `created_at`, `member_count`, `password_hash`, and `lifetime_seconds`.
- `toku:room:<roomToken>:members` (**Set**): Authoritative roster of active `pubKeyHash` members.
- `toku:room:<roomToken>:keys` (**Hash**): Maps `pubKeyHash` $\rightarrow$ raw public key bytes for pairwise encryption.
  - **Critical TTL Invariant**: All three room keys are created together in a `MULTI`/`EXEC` block with `durationSeconds`. On `addMember` or `removeMember`, the server fetches `const remainingTtl = await redis.ttl(roomKey)` and restamps all three keys with `remainingTtl` so sub-keys never become orphaned and room lifespans never extend.
- `toku:presence:<roomToken>:<pubKeyHash>` (**String**): Short-lived heartbeat lease (`"1"`). Disappears automatically if the socket drops.
- `toku:offline:<pubKeyHash>` (**Hash**): Short-term offline inbox (10-minute sliding TTL: `EXPIRE 600`).
  - **Field**: `"<roomToken>:<msgId>"`
  - **Value**: Raw `Uint8Array` frame bytes.
  - **Why Hash over List**: Eliminates $O(N)$ list scanning (`LREM`) and removes the need for servers to cache raw binary packets in RAM to match incoming ACKs. Eviction is $O(1)$ via `HDEL` using only string metadata.
  - **Crash-Safe Catch-Up**: On reconnect, `fetchBackLog` reads values via `HVALS` (`returnBuffers: true`) without deleting them. Deletion happens strictly when the client returns a `DELIVERY_ACK`.

### Layer D: The Asynchronous Worker & PostgreSQL Vault (`apps/worker` & `packages/db`)

- **Background Worker (BullMQ)**: Consumes jobs from `toku:worker:queue` to isolate slow relational disk writes from live WebSockets.
  - `TRACK_MESSAGE`: Inserts encrypted payload into `room_messages` and inserts `PENDING` rows into `delivery_receipts` for all recipients.
  - `MARK_DELIVERED`: Updates `delivery_receipts` row to `status = 'DELIVERED'` and sets `delivered_at = NOW()`.
  - `LOG_INCIDENT`: Asynchronously writes rate-limit or malformed frame violations to `security_incident_log`.
  - `Scheduled Cron Sweep`: Runs periodically (e.g., hourly) executing `DELETE FROM rooms WHERE expires_at < NOW()`.
- **Tier-2 Reconnect Fallback (Postgres Read)**: If a user stays offline longer than the 10-minute Redis TTL, the Redis Hash expires. When they reconnect, the server queries PostgreSQL using a partial index (`WHERE status = 'PENDING'`) joined with `room_messages` (filtering `WHERE r.expires_at > NOW()`), re-packs the ciphertext and iv into binary frames, and flushes them down the socket.

---

## 3. PostgreSQL Database Schema (`packages/db/src/migrations`)

```sql
-- Enums (Idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE delivery_status AS ENUM('PENDING', 'DELIVERED', 'EXPIRED', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_label') THEN
    CREATE TYPE incident_label AS ENUM('RATE_LIMIT_REDIS', 'MALFORMED_FRAME', 'ROOM_SPAM');
  END IF;
END $$;

-- 001: Master Room Lifetimer
CREATE TABLE IF NOT EXISTS rooms (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 002: Encrypted Payload Vault
CREATE TABLE IF NOT EXISTS room_messages (
  room_token TEXT NOT NULL REFERENCES rooms (token) ON DELETE CASCADE,
  message_id INT NOT NULL,
  ciphertext BYTEA NOT NULL, -- AES-GCM ciphertext with appended auth tag
  iv BYTEA NOT NULL, -- 12-byte initialization vector
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_token, message_id)
);

-- 003: Delivery Status Logbook
CREATE TABLE IF NOT EXISTS delivery_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_token TEXT NOT NULL REFERENCES rooms (token) ON DELETE CASCADE,
  recipient_hash TEXT NOT NULL,
  message_id INT NOT NULL,
  status delivery_status NOT NULL DEFAULT 'PENDING',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  FOREIGN KEY (room_token, message_id) REFERENCES room_messages (room_token, message_id) ON DELETE CASCADE,
  CONSTRAINT unique_room_msg_recipient UNIQUE (room_token, message_id, recipient_hash)
);

CREATE INDEX IF NOT EXISTS idx_delivery_pending_recipient ON delivery_receipts (recipient_hash)
WHERE
  status = 'PENDING';

-- 004: Security Audit Log
CREATE TABLE IF NOT EXISTS security_incident_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash TEXT NOT NULL,
  incident_type incident_label NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  room_token TEXT REFERENCES rooms (token) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_identity_time ON security_incident_log (identity_hash, occurred_at DESC);

-- 005: Inline Ban Gatekeeper
CREATE TABLE IF NOT EXISTS active_bans (
  identity_hash TEXT PRIMARY KEY,
  reason TEXT,
  banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_active_bans_expiry ON active_bans (expires_at);
```

---

## 4. Key Architectural Invariants

1. **Never delete from `toku:offline:<pubKeyHash>` during `fetchBackLog`**: Only delete via `HDEL` upon receiving a `DELIVERY_ACK` frame.
2. **Never use `LPUSH` or Redis Lists for the offline queue**: Keep it strictly as a Redis Hash keyed by `"<roomToken>:<msgId>"` bounded by the 600s TTL.
3. **Never extend room TTLs on activity**: Always query `redis.ttl(roomKey)` before updating sub-keys (`membersKey`, `keyringKey`) so all keys expire at the exact same timestamp.
4. **Never await Postgres writes inside WebSocket message handlers**: Only `active_bans` checks (on connect) and unread catch-up reads (on reconnect) run inline; all mutations go through BullMQ / background tasks.
5. **Rely on `ON DELETE CASCADE` for room cleanup**: Expired rooms are filtered out in SQL queries via `expires_at > NOW()` and purged lazily by a cron job deleting from `rooms`.

---

## 5. End-to-End Message Delivery Lifecycle (Step-by-Step)

Tracing a single message packet millisecond-by-millisecond from Client A to Client B (online) and Client C (offline):

### Stage 1: On-Device Encryption & Binary Framing (Client A)

- **What happens**: Client A types a message, encrypts it locally using the room's shared cryptographic state, and wraps it into a raw `Uint8Array` frame.
- **The Data Structure**: A custom flat binary buffer (`Uint8Array`) constructed via `DataView` — never JSON:
  - Byte 0: Magic byte (`0xaa`) for instant garbage filtering.
  - Byte 1: Message Type (`CHAT_MESSAGE` = `0x03`).
  - Headers: `roomToken`, sender's `pubKeyHash` (`from`), sequential 2-byte `msgId` (`Uint16`), and 8-byte `timestamp` (`BigInt`).
  - Crypto Payload: 12-byte random `iv` + `ciphertext` (with 16-byte AES-GCM auth tag natively appended at the end).
- **Design Rationale**: Eliminates text overhead, removes base64 encoding bloat (+33%), enables instant bounds checking, and allows zero-copy byte routing.

### Stage 2: Ingress Validation & State Lookup (Server 1)

- **What happens**: Server 1 receives the `Uint8Array` over Client A's WebSocket.
- **The Decoding Rule**: Server 1 runs `decodeChat()` only to inspect routing headers (`roomToken`, `from`, `msgId`). It never touches or decrypts the ciphertext or `iv`.
- **The Gatekeeper Check**: Server 1 executes `SISMEMBER toku:room:<roomToken>:members <from>`.
  - Data Structure: Redis Set (`toku:room:<roomToken>:members`).
  - Time Complexity: $O(1)$ constant-time lookup. If `SISMEMBER` returns 0, Server 1 drops the packet immediately and logs a security violation.

### Stage 3: Recipient Arbitration & Presence Checking (Server 1)

- **Fetching the Roster**: Server 1 runs `SMEMBERS toku:room:<roomToken>:members` and filters out Client A (`from`). Recipients: Client B and Client C.
- **Checking Connectivity**: Server 1 checks the presence lease for each recipient via `EXISTS toku:presence:<roomToken>:<recipientHash>`.
  - Data Structure: Redis String (`"1"`) with short 20s TTL lease.
  - Purpose: Cross-cluster discovery without querying local server RAM.

### Stage 4: The Three-Way Fork (Durable Log, Offline Cache, Live Fan-Out)

Server 1 splits execution into three parallel paths:

#### Path 1: Asynchronous Durable Persistence (For Everyone)

- Server 1 pushes a `TRACK_MESSAGE` job to BullMQ (`toku-worker`) via `workerQueue.add()` (BullMQ manages its own internal Redis streams/sets and does not use raw `LPUSH`).
- Takes `< 0.5ms` in Redis, offloading slow PostgreSQL disk I/O (`2ms–50ms`) from the live WebSocket event loop.
- The worker executes:
  1. Inserts binary `ciphertext` and `iv` into `room_messages` as native `BYTEA` columns with composite primary key `(room_token, message_id)`.
  2. Inserts `delivery_receipts` rows for both Client B and Client C with `status = 'PENDING'`.

#### Path 2: Short-Term Offline Cache (Only for Offline Client C)

- `EXISTS toku:presence:<roomToken>:C` returned 0. Client C is offline.
- Server 1 writes the raw `Uint8Array` frame into `toku:offline:<C_pubKeyHash>` with 600s sliding TTL:
  - Field: `"<roomToken>:<msgId>"` (e.g. `"rm_abc:42"`)
  - Value: Raw `Uint8Array` bytes wrapped via `Buffer.from(...)`.
- $O(1)$ `HDEL` eviction on receipt of ACK without scanning lists.

#### Path 3: Live Cluster Fan-Out (For Online Client B)

- Server 1 publishes the untouched `Uint8Array` bytes to `toku:channel:<roomToken>` via Redis Pub/Sub (`returnBuffers: true`).
- Server 2 is subscribed to `toku:channel:<roomToken>`. It receives the raw buffer, checks its local registry for Client B's socket, and flushes bytes directly down the WebSocket.
- **Race Condition Guard**: If Client B's socket disconnected 2ms before Server 2 delivered, Server 2 detects missing local socket and calls `offlineQueue.enqueue(...)`. Zero dropped messages.

### Stage 5: The Acknowledgment Loop (Crash-Safe Eviction)

- Client B receives frame, decrypts, and replies with `DELIVERY_ACK` binary packet (`roomToken`, `from: B`, `msgId: 42`).
- Server 2:
  1. If B was online: skips Redis offline eviction, pushes `MARK_DELIVERED` to BullMQ.
  2. If B was catching up: executes `HDEL toku:offline:B "rm_abc:42"` and pushes `MARK_DELIVERED` to BullMQ.
- Worker finalizes:
  ```sql
  UPDATE delivery_receipts
  SET
    status = 'DELIVERED',
    delivered_at = NOW()
  WHERE
    room_token = $1
    AND message_id = $2
    AND recipient_hash = $3;
  ```

### Stage 6: Dual-Source Reconnect Catch-Up (Client C Returns)

#### Scenario A: Reconnects within 10 minutes (Fast RAM Tier)

1. Server checks `toku:offline:C` via `HVALS` (`returnBuffers: true`).
2. Raw frames exist in Redis RAM. Server flushes them down Client C's WebSocket without deleting them.
3. Client C processes frames and replies with `DELIVERY_ACK` $\rightarrow$ Server executes `HDEL` and queues `MARK_DELIVERED`.

#### Scenario B: Reconnects after 10 minutes (Durable Disk Tier)

1. 10-minute Redis Hash has expired.
2. Server queries PostgreSQL:
   ```sql
   SELECT
     m.room_token,
     m.message_id,
     m.ciphertext,
     m.iv,
     m.created_at
   FROM
     delivery_receipts dr
     JOIN room_messages m ON m.room_token = dr.room_token
     AND m.message_id = dr.message_id
     JOIN rooms r ON r.token = dr.room_token
   WHERE
     dr.recipient_hash = $1
     AND dr.status = 'PENDING'
     AND r.expires_at > NOW()
   ORDER BY
     m.message_id ASC;
   ```
3. Partial index `idx_delivery_pending_recipient` enables microsecond lookup.
4. Server repacks `BYTEA` data into binary `CHAT_MESSAGE` frames, dispatches to Client C $\rightarrow$ Client C ACKs $\rightarrow$ BullMQ marks `DELIVERED`.

### Stage 7: Lifecycle Termination & Automated Cleanup

- **Redis Cleanup**: When a room is created, all keys receive `durationSeconds`. On join/leave, `redis.ttl(roomKey)` restamps all sub-keys with remaining time.
- **Postgres Cleanup**: Periodic cron runs `DELETE FROM rooms WHERE expires_at < NOW()`. Cascades automatically via `ON DELETE CASCADE` to delete `room_messages` and `delivery_receipts`.

---

## 6. Background Worker Job Specification (`apps/worker`)

All asynchronous database mutations and periodic maintenance tasks are offloaded to **`apps/worker`** via BullMQ on Redis queue `toku-worker`. This guarantees that the WebSocket gateway never waits on PostgreSQL disk I/O.

### 6.1 Queue Configuration & Resilience Strategy (`apps/api/src/queue.ts`)

The BullMQ producer queue (`toku-worker`) is configured with production-grade reliability parameters:

- **`attempts: 3`**: Automatic retries if PostgreSQL encounters a momentary timeout, connection pool saturation, or query deadlock.
- **`backoff: { type: 'exponential', delay: 1000, jitter: 0.5 }`**: Eliminates the "lockstep march" / thundering herd problem by scattering retry wakeups randomly across a $\pm 50\%$ time window when PostgreSQL recovers.
- **`removeOnComplete: true`**: Crucial for high-throughput chat; purges finished jobs immediately from Redis RAM to prevent memory leaks and out-of-memory (OOM) crashes.
- **`removeOnFail: { count: 1000 }`**: Caps retained error logs to the last 1,000 jobs so failed executions can be debugged without leaking memory indefinitely.

### 6.2 Worker Job Catalog (Master Table)

| Job Name                     | Type  | Trigger / Schedule                                                     | Queue / Target            | Primary Database Action & Invariant                                                                                                                                                | Target Tables                                  |
| :--------------------------- | :---- | :--------------------------------------------------------------------- | :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| **`TRACK_MESSAGE`**          | Event | `CHAT_MESSAGE` binary frame received & validated                       | `toku-worker`             | Atomically inserts ciphertext + IV into `room_messages`, then creates `PENDING` rows in `delivery_receipts` for all room recipients.                                               | `room_messages`, `delivery_receipts`           |
| **`MARK_DELIVERED`**         | Event | `DELIVERY_ACK` binary frame received from recipient                    | `toku-worker`             | Updates receipt `status = 'DELIVERED'` and sets `delivered_at = NOW()`. If burn-after-read is enabled and all recipients ACKed, purges message from `room_messages`.               | `delivery_receipts`, `room_messages`           |
| **`LOG_INCIDENT`**           | Event | Malformed frame, invalid magic byte, room spam, or rate limit exceeded | `toku-worker`             | Writes incident record to `security_incident_log`. If identity exceeds threshold ($\ge 5$ violations in 10m), auto-creates temporary ban in `active_bans` and sets Redis edge key. | `security_incident_log`, `active_bans`         |
| **`CLEANUP_EXPIRED_ROOMS`**  | Cron  | Every 15 minutes (`*/15 * * * *`)                                      | Worker Internal Scheduler | Deletes expired rooms (`WHERE expires_at < NOW()`). Relies on `ON DELETE CASCADE` to atomically purge all child messages and receipts.                                             | `rooms` (`room_messages`, `delivery_receipts`) |
| **`CLEANUP_EXPIRED_BANS`**   | Cron  | Hourly (`0 * * * *`)                                                   | Worker Internal Scheduler | Prunes expired bans (`WHERE expires_at < NOW()`) to keep the table compact for microsecond inline index scans on socket connect.                                                   | `active_bans`                                  |
| **`CLEANUP_STALE_RECEIPTS`** | Cron  | Daily (`0 2 * * *`)                                                    | Worker Internal Scheduler | Marks unclaimed offline receipts as `'EXPIRED'` if room reached absolute expiration deadline without delivery.                                                                     | `delivery_receipts`                            |
| **`CLEANUP_INCIDENT_LOGS`**  | Cron  | Weekly (`0 3 * * 0`)                                                   | Worker Internal Scheduler | Permanently prunes security logs older than 7 days to preserve zero-knowledge, privacy-first data retention principles.                                                            | `security_incident_log`                        |

### 6.3 Event-Driven Job Definitions

#### 1. `TRACK_MESSAGE`

- **Trigger**: Server validates an incoming binary `CHAT_MESSAGE` frame and fans it out.
- **Job Payload**:
  ```json
  {
    "type": "TRACK_MESSAGE",
    "roomToken": "rm_xxxxxxxx",
    "msgId": 42,
    "ciphertextHex": "a1b2c3...",
    "ivHex": "d4e5f6...",
    "recipientHashes": ["hash_bob", "hash_carol"],
    "createdAt": 1731675600000
  }
  ```
- **Worker Execution (Atomic Transaction)**:
  ```sql
  -- 1. Insert encrypted payload into vault
  INSERT INTO room_messages (room_token, message_id, ciphertext, iv, created_at)
  VALUES ($1, $2, decode($3, 'hex'), decode($4, 'hex'), to_timestamp($5 / 1000.0));

  -- 2. Create pending delivery receipts for all room recipients
  INSERT INTO delivery_receipts (room_token, recipient_hash, message_id, status)
  VALUES ($1, unnest($recipients::text[]), $2, 'PENDING');
  ```

#### 2. `MARK_DELIVERED`

- **Trigger**: Server receives a `DELIVERY_ACK` binary frame from a recipient.
- **Job Payload**:
  ```json
  {
    "type": "MARK_DELIVERED",
    "roomToken": "rm_xxxxxxxx",
    "msgId": 42,
    "recipientHash": "hash_bob",
    "deliveredAt": 1731675601200
  }
  ```
- **Worker Execution**:
  ```sql
  -- 1. Mark receipt delivered
  UPDATE delivery_receipts
  SET
    status = 'DELIVERED',
    delivered_at = to_timestamp($4 / 1000.0)
  WHERE
    room_token = $1
    AND message_id = $2
    AND recipient_hash = $3;
  
  -- 2. Burn-after-read check (optional flag):
  -- If all recipients have delivered_at set, purge ciphertext immediately:
  DELETE FROM room_messages
  WHERE
    room_token = $1
    AND message_id = $2
    AND NOT EXISTS (
      SELECT
        1
      FROM
        delivery_receipts
      WHERE
        room_token = $1
        AND message_id = $2
        AND status = 'PENDING'
    );
  ```

#### 3. `LOG_INCIDENT`

- **Trigger**: Ingress gateway detects invalid magic bytes, frame boundary overruns, or rate-limit violations.
- **Job Payload**:
  ```json
  {
    "type": "LOG_INCIDENT",
    "identityHash": "hash_attacker",
    "incidentType": "MALFORMED_FRAME",
    "roomToken": "rm_xxxxxxxx",
    "occurredAt": 1731675602000
  }
  ```
- **Worker Execution**:
  ```sql
  -- 1. Record security audit log
  INSERT INTO
    security_incident_log (
      identity_hash,
      incident_type,
      room_token,
      occurred_at
    )
  VALUES
    ($1, $2, $3, to_timestamp($4 / 1000.0));
  
  -- 2. Check escalation threshold (>= 5 incidents in last 10 minutes)
  -- If threshold tripped, enforce 1-hour active ban:
  INSERT INTO
    active_bans (identity_hash, reason, banned_at, expires_at)
  SELECT
    $1,
    'Automated rate limit / protocol breach escalation',
    NOW(),
    NOW() + INTERVAL '1 hour'
  WHERE
    (
      SELECT
        COUNT(*)
      FROM
        security_incident_log
      WHERE
        identity_hash = $1
        AND occurred_at > NOW() - INTERVAL '10 minutes'
    ) >= 5
  ON CONFLICT (identity_hash) DO UPDATE
  SET
    expires_at = NOW() + INTERVAL '1 hour';
  ```

### 6.4 Scheduled Sweeper Jobs (Cron Maintenance)

| Cron Job                 | Frequency                     | SQL Operation                                                                                                                                    | Purpose                                                                                                                |
| :----------------------- | :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `CLEANUP_EXPIRED_ROOMS`  | Every 15 min (`*/15 * * * *`) | `DELETE FROM rooms WHERE expires_at < NOW();`                                                                                                    | Master room purge. Cascades via foreign keys to atomically wipe all child `room_messages` and `delivery_receipts`.     |
| `CLEANUP_EXPIRED_BANS`   | Hourly (`0 * * * *`)          | `DELETE FROM active_bans WHERE expires_at < NOW();`                                                                                              | Keeps the `active_bans` index shallow to maintain sub-millisecond query performance for inline connection gate checks. |
| `CLEANUP_STALE_RECEIPTS` | Daily (`0 2 * * *`)           | `UPDATE delivery_receipts SET status = 'EXPIRED' WHERE status = 'PENDING' AND room_token IN (SELECT token FROM rooms WHERE expires_at < NOW());` | Closes out abandoned offline message receipts for rooms that have reached their absolute lifespan.                     |
| `CLEANUP_INCIDENT_LOGS`  | Weekly (`0 3 * * 0`)          | `DELETE FROM security_incident_log WHERE occurred_at < NOW() - INTERVAL '7 days';`                                                               | Enforces zero-knowledge data retention by wiping security audit logs older than 7 days.                                |
