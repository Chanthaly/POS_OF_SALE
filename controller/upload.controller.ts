import type { Request, Response } from 'express';
import { serviceMessage } from '../utils/service.Message.js';

export const uploadImage = (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({
      resultCode: 400,
      message: serviceMessage.IMAGE_REQUIRED,
    });
  }

  return res.status(201).json({
    resultCode: 201,
    message: serviceMessage.IMAGE_UPLOADED_SUCCESSFULLY,
    data: {
      filename: req.file.filename,
    },
  });
};