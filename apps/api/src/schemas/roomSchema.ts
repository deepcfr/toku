import { z } from "zod";

// validates POST /rooms req body
export const createRoomSchema = z.object({
  durationSeconds: z
    .number()
    .int("Duration must be an integer")
    .min(60, "Duration must be atleast 60 seconds")
    .max(86400, "Duration cannot exceed 24 hours"),
  passwordHash: z.string().min(1, "Password hash is required"),
  maxParticipants: z
    .number()
    .int("Max participants must be an integer")
    .min(2, "Room must allow at least 2 participants")
    .max(16, "Room cannot exceed 16 participants")
    .optional(),
  isDm: z.boolean().optional(),
});

// validates POST /rooms/:token/verify req body
export const verifyPasswordSchema = z.object({
  passwordProof: z.string().min(1, "Password proof is required"),
});

// validates :token route parameter (like GET /rooms/:token)
export const roomTokenParamsSchema = z.object({
  token: z.string().min(1, "Room token is required"),
});

// validates DELETE /rooms/:token req body (optional)
export const purgeRoomSchema = z
  .object({
    creatorKey: z.string().optional(),
    passwordProof: z.string().optional(),
  })
  .optional();

export type CreateRoomBody = z.infer<typeof createRoomSchema>;
export type VerifyPasswordBody = z.infer<typeof verifyPasswordSchema>;
export type RoomTokenParams = z.infer<typeof roomTokenParamsSchema>;
export type PurgeRoomBody = z.infer<typeof purgeRoomSchema>;
