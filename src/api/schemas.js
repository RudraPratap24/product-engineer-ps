import { z } from "zod";

export const createEventSchema = z.object({
  eventId: z.string().min(1).max(100),

  type: z.string().min(1).max(100),

  occurredAt: z.iso.datetime(),

  payload: z.record(z.string(), z.unknown())
});