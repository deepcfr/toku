import type { RateLimitAction } from "./rate-limit";

export const RedisKeys = {
  room: (roomToken: string) => `toku:room:${roomToken}`,
  roomMembers: (roomToken: string) => `toku:room:${roomToken}:members`,
  roomKeys: (roomToken: string) => `toku:room:${roomToken}:keys`,
  roomEvents: (roomToken: string) => `toku:room:${roomToken}:events`,
  roomChannel: (roomToken: string) => `toku:channel:${roomToken}`,
  presence: (roomToken: string, pubKeyHash: string) =>
    `toku:presence:${roomToken}:${pubKeyHash}`,
  offlineQueue: (pubKeyHash: string) => `toku:offline:${pubKeyHash}`,
  rateLimit: (action: RateLimitAction, target: string) =>
    `toku:rl:${action}:${target}`,
  ban: (identityHash: string) => `toku:ban:${identityHash}`,
} as const;
