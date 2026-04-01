import { Client as MinioClient } from "minio";
import { config } from "../config";

export const storage = new MinioClient({
  endPoint: config.minio.endpoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
});

export async function ensureBucket(): Promise<void> {
  const exists = await storage.bucketExists(config.minio.bucket);
  if (!exists) {
    await storage.makeBucket(config.minio.bucket);
    console.log(`Bucket '${config.minio.bucket}' created`);
  }
}

export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  await storage.putObject(config.minio.bucket, key, buffer, buffer.length, {
    "Content-Type": contentType,
  });
  return key;
}

export async function getFileUrl(key: string, expiresSeconds = 3600): Promise<string> {
  return storage.presignedGetObject(config.minio.bucket, key, expiresSeconds);
}

export async function deleteFile(key: string): Promise<void> {
  await storage.removeObject(config.minio.bucket, key);
}
