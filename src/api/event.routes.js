import { Router } from "express";
import {
  createEventHandler,
  getEventHandler
} from "./event.controller.js";

const router = Router();

router.post("/events", createEventHandler);
router.get("/events/:eventId", getEventHandler);

export default router;