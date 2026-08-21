
import jwt, {
  type JwtPayload,
} from 'jsonwebtoken';

import type {
  Request,
  Response,
  NextFunction,
} from 'express';

const JWT_SECRET = 'datetimenew----a@2026datnow--selectkey';

interface UserJwt extends JwtPayload {
  user_id: number;
  username: string;
  role: 'user' | 'admin' | 'superuser';
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user_id?: number;
      user_name?: string;
      user_role?: 'user' | 'admin' | 'superuser';
    }
  }
}

export const verifyJWT = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authKey = req.headers.authorization;

  // Check Authorization header
  if (
    !authKey ||
    !authKey.startsWith('Bearer ')
  ) {
    return res.status(401).json({
      resultCode: 401,
      message: 'Unauthorized',
    });
  }

  // Get token
  const token = authKey.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      resultCode: 401,
      message: 'Token not found',
    });
  }

  // Verify JWT
  jwt.verify(
    token,
    JWT_SECRET,
    {
      algorithms: ['HS256'],
    },
    (err, decoded) => {
      // Token invalid / expired
      if (err) {
        console.log('JWT error:', err.message);

        return res.status(401).json({
          resultCode: 401,
          message: 'Invalid or expired token',
        });
      }

      // Decode payload
      const user = decoded as UserJwt;

      // Save user information into request
      req.user_id = user.user_id;
      req.user_name = user.username;
      req.user_role = user.role;

      console.log('JWT verified:', user);

      // Continue to controller
      next();
    }
  );
};

