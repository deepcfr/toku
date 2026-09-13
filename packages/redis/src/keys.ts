export const RedisKeys = {
  room: (roomToken: string) => `toku:room:${roomToken}`,
  roomMembers: (roomToken: string) => `toku:room:${roomToken}:members`,
  roomKeys: (roomToken: string) => `toku:room:${roomToken}:keys`,
  roomEvents: (roomToken: string) => `toku:room:${roomToken}:events`,
  roomChannel: (roomToken: string) => `toku:channel:${roomToken}`,
  presence: (roomToken: string, pubKeyHash: string) =>
    `toku:presence:${roomToken}:${pubKeyHash}`,
  offlineQueue: (recipientHash: string) => `toku:offline:${recipientHash}`,
  rateLimit: (action: string, target: string) => `toku:rl:${action}:${target}`,
  ban: (identityHash: string) => `toku:ban:${identityHash}`,
};
