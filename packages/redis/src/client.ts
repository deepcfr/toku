import { createClient, type RedisClientType } from "redis";

// we need different clients
export interface RedisClients {
  client: RedisClientType;
  pub: RedisClientType;
  sub: RedisClientType;
}

// Node's EventEmitter (which Redis client extends) terminates the process if 'error' is emitted with no listener.
function attachErrorListener(
  client: RedisClientType,
  label: "client" | "pub" | "sub"
) {
  client.on("error", err => {
    console.error(`[Redis:${label}] Client Error:`, err);
  });
}

// create all the redis clients
export function createRedisClients(): RedisClients {
  // create the primary general-purpose client
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: retries => Math.min(retries * 100, 3000),
    },
  }) as RedisClientType;

  // clone the rest
  const pub = client.duplicate() as RedisClientType;
  const sub = client.duplicate() as RedisClientType;

  attachErrorListener(client, "client");
  attachErrorListener(pub, "pub");
  attachErrorListener(sub, "sub");

  return { client, pub, sub };
}
