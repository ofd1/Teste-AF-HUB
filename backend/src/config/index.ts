import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",

  database: {
    url: process.env.DATABASE_URL || "postgresql://af_hub:af_hub_pass@localhost:5432/af_hub?schema=public",
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  jwt: {
    secret: process.env.JWT_SECRET || "change-me-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
  },

  minio: {
    endpoint: process.env.MINIO_ENDPOINT || "localhost",
    port: parseInt(process.env.MINIO_PORT || "9000"),
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    bucket: process.env.MINIO_BUCKET || "af-hub",
    useSSL: process.env.MINIO_USE_SSL === "true",
  },

  sandbox: {
    network: process.env.SANDBOX_NETWORK || "af-hub-sandbox",
    memoryLimit: process.env.SANDBOX_MEMORY_LIMIT || "256m",
    cpuLimit: process.env.SANDBOX_CPU_LIMIT || "0.5",
  },
};
