import { createRedisClients } from "@toku/redis";

// 3 clients: standard commands, publisher, and dedicated subscriber (pub/sub blocks regular commands)
export const redis = createRedisClients();

// connects all three clients concurrently via TCP handshakes (idempotent if already open)
export async function connectRedis() {
  const connectPromises = [redis.client, redis.pub, redis.sub].map(
    async cli => {
      if (!cli.isOpen) {
        await cli.connect();
      }
    }
  );
  await Promise.all(connectPromises);
}

// gracefully closes open connections on shutdown
export async function disconnectRedis() {
  const closePromises = [redis.client, redis.pub, redis.sub].map(async cli => {
    if (cli.isOpen) {
      try {
        await cli.close();
      } catch (error) {
        console.error("Error while closing a Redis client connection:", error);
      }
    }
  });

  // allSettled ensures all sockets attempt to close even if one fails
  await Promise.allSettled(closePromises);
}
