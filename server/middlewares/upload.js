// server/middlewares/upload.js
import multer from "multer";

export function createUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  });
}
