// server/middlewares/upload.js
import multer from "multer";

export function createUpload({ fileSizeMb = 20 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: fileSizeMb * 1024 * 1024 },
  });
}
