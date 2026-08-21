
import jwt, { type SignOptions } from 'jsonwebtoken';
const JWT_SECRET = 'datetimenew----a@2026datnow--selectkey';

type JwtExpiresIn = NonNullable<SignOptions['expiresIn']>;

export const genAccessJWT = (payload: object): string => {
  const accessOption: jwt.SignOptions = {
    algorithm: 'HS256',
  };

  const jwtExpiration = process.env.JWT_EXP;

  if (typeof jwtExpiration === 'string' && jwtExpiration.trim() !== '') {
    const rawValue = jwtExpiration.trim();
    const numericValue = Number(rawValue);

    if (Number.isFinite(numericValue)) {
      accessOption.expiresIn = numericValue as JwtExpiresIn;
    } else if (/^\d+(ms|s|m|h|d|w|y)$/i.test(rawValue)) {
      accessOption.expiresIn = rawValue.toLowerCase() as JwtExpiresIn;
    }
  }

  const token = jwt.sign(
    payload,
    JWT_SECRET,
    accessOption
  );

  return token;
};

