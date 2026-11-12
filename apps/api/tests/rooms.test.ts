import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { RedisKeys } from "@toku/redis";
import app from "../src/app";
import { db } from "../src/db";
import { connectRedis, disconnectRedis, redis } from "../src/redis";

let testIpCounter = 1;
function nextTestIp() {
  return `10.42.${Math.floor(testIpCounter / 250)}.${(testIpCounter++ % 250) + 1}`;
}

function testRequest(
  path: string,
  options: RequestInit = {},
  ip = nextTestIp()
) {
  const headers = new Headers(options.headers);
  if (!headers.has("x-forwarded-for")) {
    headers.set("x-forwarded-for", ip);
  }
  return app.request(path, { ...options, headers });
}

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  await disconnectRedis();
  await db.end();
});

describe("Room HTTP API Lifecycle", () => {
  describe("POST /v1/api/rooms (Create Room)", () => {
    it("creates a group room with defaults and persists to both Postgres and Redis", async () => {
      const res = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "test_pw_hash_group",
          maxParticipants: 8,
          isDm: false,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.token).toStartWith("rm_");
      expect(json.data.creatorKey).toStartWith("cr_");
      expect(json.data.memberCount).toBe(0);
      expect(json.data.maxParticipants).toBe(8);
      expect(json.data.isDm).toBe(false);
      expect(json.data.remainingSeconds).toBe(300);

      const token = json.data.token;

      // verify write-through persistence in Postgres
      const [pgRow] =
        await db`SELECT token, expires_at FROM rooms WHERE token = ${token}`;
      expect(pgRow).toBeDefined();
      expect(pgRow?.token).toBe(token);

      // verify hot cache in Redis with TTL
      const redisHash = await redis.client.hGetAll(RedisKeys.room(token));
      expect(redisHash.password_hash).toBe("test_pw_hash_group");
      expect(redisHash.member_count).toBe("0");
      expect(redisHash.is_dm).toBe("0");

      const redisTtl = await redis.client.ttl(RedisKeys.room(token));
      expect(redisTtl).toBeGreaterThan(0);
      expect(redisTtl).toBeLessThanOrEqual(300);

      // cleanup
      await app.request(`/v1/api/rooms/${token}`, {
        method: "DELETE",
        headers: { "x-creator-key": json.data.creatorKey },
      });
    });

    it("creates a 1:1 DM room and strictly enforces 2 participants", async () => {
      const res = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 600,
          passwordHash: "test_pw_hash_dm",
          isDm: true,
          maxParticipants: 10, // should be forced to 2
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.token).toStartWith("dm_");
      expect(json.data.isDm).toBe(true);
      expect(json.data.maxParticipants).toBe(2);

      // cleanup
      await app.request(`/v1/api/rooms/${json.data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": json.data.creatorKey },
      });
    });

    it("rejects invalid room creation input (< 60s duration)", async () => {
      const res = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 30, // below min: 60
          passwordHash: "test_pw_hash",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBeDefined();
    });
  });

  describe("GET /v1/api/rooms/:token (Metadata & Cache Hierarchy)", () => {
    it("returns metadata directly from Redis cache first", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "cache_first_test",
        }),
      });
      const { data } = await createRes.json();

      const getRes = await testRequest(`/v1/api/rooms/${data.token}`);
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.success).toBe(true);
      expect(getJson.data.token).toBe(data.token);
      expect(getJson.data.remainingSeconds).toBeGreaterThan(0);

      // cleanup
      await app.request(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });
    });

    it("falls back to PostgreSQL when Redis cache misses for an active room", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "fallback_test",
        }),
      });
      const { data } = await createRes.json();

      // deliberately evict key from Redis to simulate cache miss / server restart
      await redis.client.del(RedisKeys.room(data.token));

      // request should fall back to DB and succeed
      const getRes = await testRequest(`/v1/api/rooms/${data.token}`);
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.data.token).toBe(data.token);
      expect(getJson.data.remainingSeconds).toBeGreaterThan(0);

      // cleanup from DB
      await db`DELETE FROM rooms WHERE token = ${data.token}`;
    });

    it("returns 410 Gone when room has expired in PostgreSQL", async () => {
      const expiredToken = "rm_expired_mock_token_999";
      await db`
        INSERT INTO rooms (token, created_at, expires_at)
        VALUES (${expiredToken}, ${new Date(Date.now() - 10000)}, ${new Date(Date.now() - 1000)})
        ON CONFLICT (token) DO UPDATE SET expires_at = ${new Date(Date.now() - 1000)}
      `;

      const getRes = await testRequest(`/v1/api/rooms/${expiredToken}`);
      expect(getRes.status).toBe(410);
      const json = await getRes.json();
      expect(json.code).toBe("GONE");

      // cleanup
      await db`DELETE FROM rooms WHERE token = ${expiredToken}`;
    });

    it("returns 404 Not Found for non-existent room token", async () => {
      const getRes = await testRequest(
        "/v1/api/rooms/rm_non_existent_token_000"
      );
      expect(getRes.status).toBe(404);
      const json = await getRes.json();
      expect(json.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /v1/api/rooms/:token/verify (Password Proof)", () => {
    it("returns 200 when client password proof matches constant-time comparison", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "secret_salt_and_hash_xyz",
        }),
      });
      const { data } = await createRes.json();

      const verifyRes = await testRequest(
        `/v1/api/rooms/${data.token}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passwordProof: "secret_salt_and_hash_xyz" }),
        }
      );

      expect(verifyRes.status).toBe(200);
      const verifyJson = await verifyRes.json();
      expect(verifyJson.verified).toBe(true);

      // cleanup
      await app.request(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });
    });

    it("returns 401 Unauthorized when password proof is incorrect", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "correct_proof",
        }),
      });
      const { data } = await createRes.json();

      const verifyRes = await testRequest(
        `/v1/api/rooms/${data.token}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passwordProof: "wrong_proof" }),
        }
      );

      expect(verifyRes.status).toBe(401);
      const verifyJson = await verifyRes.json();
      expect(verifyJson.code).toBe("UNAUTHORIZED");

      // cleanup
      await app.request(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });
    });
  });

  describe("DELETE /v1/api/rooms/:token (Purge Authority)", () => {
    it("denies group room deletion without creator key (403 Forbidden)", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "group_pw",
          isDm: false,
        }),
      });
      const { data } = await createRes.json();

      // Guest attempts delete with only password proof
      const delRes = await testRequest(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordProof: "group_pw" }),
      });

      expect(delRes.status).toBe(403);
      const json = await delRes.json();
      expect(json.code).toBe("FORBIDDEN");

      // cleanup with valid creator key
      await app.request(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });
    });

    it("denies group room deletion with invalid creator key", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "group_pw_2",
          isDm: false,
        }),
      });
      const { data } = await createRes.json();

      const delRes = await testRequest(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": "cr_invalid_key_attempt" },
      });

      expect(delRes.status).toBe(403);

      // cleanup
      await app.request(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });
    });

    it("purges group room with valid creator key from both Redis and Postgres", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "purge_pw",
          isDm: false,
        }),
      });
      const { data } = await createRes.json();

      const delRes = await testRequest(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });

      expect(delRes.status).toBe(200);
      const delJson = await delRes.json();
      expect(delJson.success).toBe(true);

      // Verify erased from Redis
      const redisExists = await redis.client.exists(RedisKeys.room(data.token));
      expect(redisExists).toBe(0);

      // Verify erased from Postgres
      const [pgRow] =
        await db`SELECT token FROM rooms WHERE token = ${data.token}`;
      expect(pgRow).toBeUndefined();

      // Subsequent GET returns 404
      const getRes = await testRequest(`/v1/api/rooms/${data.token}`);
      expect(getRes.status).toBe(404);
    });

    it("allows 1:1 DM deletion by counterparty using passwordProof (Telegram-style purge for both)", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "shared_dm_secret",
          isDm: true,
        }),
      });
      const { data } = await createRes.json();

      // Counterparty (who does NOT have creatorKey) deletes using shared passwordProof
      const delRes = await testRequest(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordProof: "shared_dm_secret" }),
      });

      expect(delRes.status).toBe(200);

      // Verify completely purged from Redis and Postgres
      const redisExists = await redis.client.exists(RedisKeys.room(data.token));
      expect(redisExists).toBe(0);

      const [pgRow] =
        await db`SELECT token FROM rooms WHERE token = ${data.token}`;
      expect(pgRow).toBeUndefined();
    });
  });

  describe("Rate Limiting on Room Endpoints", () => {
    it("enforces sliding window rate limit on verify password per client+room target", async () => {
      const createRes = await testRequest("/v1/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationSeconds: 300,
          passwordHash: "rate_limit_test_pw",
        }),
      });
      const { data } = await createRes.json();

      const attackerIp = nextTestIp();

      // Exhaust limit of 5 requests per minute
      for (let i = 0; i < 5; i++) {
        await testRequest(
          `/v1/api/rooms/${data.token}/verify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passwordProof: "wrong" }),
          },
          attackerIp
        );
      }

      // 6th request from attacker should get 429
      const rateLimitedRes = await testRequest(
        `/v1/api/rooms/${data.token}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passwordProof: "wrong" }),
        },
        attackerIp
      );

      expect(rateLimitedRes.status).toBe(429);
      const json = await rateLimitedRes.json();
      expect(json.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(rateLimitedRes.headers.get("retry-after")).toBeDefined();

      // A different IP target should still be allowed (compound key prevents cross-client collateral damage)
      const harmlessIp = nextTestIp();
      const allowedRes = await testRequest(
        `/v1/api/rooms/${data.token}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passwordProof: "rate_limit_test_pw" }),
        },
        harmlessIp
      );
      expect(allowedRes.status).toBe(200);

      // cleanup
      await app.request(`/v1/api/rooms/${data.token}`, {
        method: "DELETE",
        headers: { "x-creator-key": data.creatorKey },
      });
    });
  });
});
