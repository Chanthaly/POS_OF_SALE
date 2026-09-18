import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, '../uploads');

fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const uploadImage = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_req, file, callback) => {
      const extensionByType: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
      };
      callback(null, `${crypto.randomUUID()}${extensionByType[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error('Only JPEG, PNG, WEBP, and GIF images are allowed'));
      return;
    }
    callback(null, true);
  },
});

export const handleImageUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadImage.single('image')(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Image size must not exceed 5 MB'
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Upload exactly one image using the field name "image"'
          : error.message;
      res.status(400).json({ resultCode: 400, message });
      return;
    }

    if (error instanceof Error && error.message === 'Field name missing') {
      res.status(400).json({
        resultCode: 400,
        message: 'Multipart file field is missing. Send the image using the field name "image"',
      });
      return;
    }

    res.status(400).json({
      resultCode: 400,
      message: error instanceof Error ? error.message : 'Invalid image upload',
    });
  });
};