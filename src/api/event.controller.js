import { createEventSchema } from "./schemas.js";
import { ingestEvent } from "../services/event.service.js";
import { getEventDetails } from "../services/event-query.service.js";

export async function createEventHandler(req, res, next) {
  try {
    const parsed = createEventSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.flatten()
      });
    }

    const result = await ingestEvent(parsed.data);

    return res.status(result.duplicate ? 200 : 202).json({
      eventId: result.event.eventId,
      status: result.event.status,
      duplicate: result.duplicate
    });
  } catch (error) {
    next(error);
  }
}

export async function getEventHandler(req, res, next) {
  try {
    const { eventId } = req.params;

    const result = await getEventDetails(eventId);

    if (!result) {
      return res.status(404).json({
        error: "Event not found"
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}