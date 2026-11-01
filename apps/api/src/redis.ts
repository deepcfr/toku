// redis client singleton
// but it has 3 clients - standard, pub, sub
import { createRedisClients } from "@toku/redis";

// shared redis client connection
export const redis = createRedisClients();

// connect all the 3 clients concurrently
export async function connectRedis() {
  await Promise.all([
    redis.client.connect(),
    redis.pub.connect(),
    redis.sub.connect(),
  ]);
}

// gracefully close open connections on shutdown
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

  await Promise.allSettled(closePromises);
}
