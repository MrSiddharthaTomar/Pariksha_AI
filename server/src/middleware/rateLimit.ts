import { Request, Response, NextFunction } from 'express';

type Entry = {
  count: number;
  resetAt: number;
};

const requestBuckets = new Map<string, Entry>();

const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
};

export const createRateLimiter = (maxAttempts: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${req.path}:${getClientIp(req)}`;
    const current = requestBuckets.get(key);

    if (!current || now > current.resetAt) {
      requestBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= maxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      return res.status(429).json({
        message: 'Too many requests. Please try again later.',
        error: 'RATE_LIMITED',
      });
    }

    current.count += 1;
    requestBuckets.set(key, current);
    return next();
  };
};

