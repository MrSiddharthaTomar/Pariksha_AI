import jwt, { Secret } from 'jsonwebtoken';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
// import 

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
export const generateJwtForUser = (user: any) => {
    const payload = { id: (user._id as any).toString(), role: user.role, email: user.email, name: user.fullName };
    return (jwt as any).sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};


export const authenticateJWT = (req: Request, res: Response, next: Function) => {
  const authHeader = (req.headers['authorization'] || '') as string;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token && req.query) {
    const queryToken = (req.query as any).token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      token = queryToken.trim();
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Missing or invalid authentication token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // attach to request
    (req as any).user = decoded;
    next();
  } catch (err: any) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};