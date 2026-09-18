import type { Request, Response } from 'express';

export const uploadImage = (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({
      resultCode: 400,
      message: 'Image file is required in the "image" field',
    });
  }

  return res.status(201).json({
    resultCode: 201,
    message: 'Image uploaded successfully',
    data: {
      filename: req.file.filename,
    },
  });
};