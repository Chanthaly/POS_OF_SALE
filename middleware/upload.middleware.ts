import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { serviceMessage } from '../utils/service.Message.js';

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
      callback(new Error(serviceMessage.IMAGE_TYPES_NOT_ALLOWED));
      return;
    }
    callback(null, true);
  },
});

const handleSingleImageUpload = (fieldName: string) => (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  uploadImage.single(fieldName)(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? serviceMessage.IMAGE_SIZE_LIMIT
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? serviceMessage.UPLOAD_UNEXPECTED_FILE(fieldName)
          : error.message;
      res.status(400).json({ resultCode: 400, message });
      return;
    }

    if (error instanceof Error && error.message === 'Field name missing') {
      res.status(400).json({
        resultCode: 400,
        message: serviceMessage.UPLOAD_FILE_FIELD_MISSING(fieldName),
      });
      return;
    }

    res.status(400).json({
      resultCode: 400,
      message: error instanceof Error ? error.message : serviceMessage.IMAGE_UPLOAD_INVALID,
    });
  });
};

export const handleImageUpload = handleSingleImageUpload('image');
export const handleCompanyLogoUpload = handleSingleImageUpload('logo');