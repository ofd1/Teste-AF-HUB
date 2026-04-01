import Redis from "ioredis";
import { config } from "../config";

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err.message);
});
