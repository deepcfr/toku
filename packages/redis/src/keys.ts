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

// keys note(im lazy to save them in obsidian)
/**
 * roomToken = lobby
 * roomKey = toku:room:lobby = room metadata key. stores necessary information about the room. uses hash, each field can be updated independently in O(1) time
 * membersKey = toku:room:lobby:members = stores all the members of a room. uses set, duplicates are physically impossible. used for checking membership of users
 * keyRingKey = toku:room:lobby:keys = stores all the actual public keys of the users using a hash, because one member needs everyone else's public keys to encrypt the messages
 * roomEventsKey = toku:room:lobby:events = reserved, no reader yet. will hold room activity for the worker feed
 * roomChannel = toku:channel:lobby = pub/sub bridge between servers. not storage, messages vanish after broadcast, no TTL
 * presenceKey = toku:presence:lobby:ab12 = one member's heartbeat lease. plain string "1" with 20s expiry, client re-pings to keep it alive. missing key = offline
 * offlineKey = toku:offline:ab12 = offline pigeonhole for one member. hash of room:msgId -> frame bytes, 10m sliding expiry, capped near 100
 * rateLimitKey = toku:rl:send_message:ab12 = sliding window counter per action+target. sorted set of request timestamps, lua trims outside the window
 * banKey = toku:ban:ab12 = reserved, no reader yet. server will check it before admitting sockets, pairs with active_bans table
 */
