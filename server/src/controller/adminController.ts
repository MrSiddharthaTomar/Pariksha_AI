import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import AdminAuditLog from '../models/AdminAuditLog';
import AdminSession from '../models/AdminSession';
import ExamAttempt from '../models/ExamAttempt';
import ProctoringLog from '../models/ProctoringLog';
import User from '../models/User';
import { PASSWORD_POLICY_MESSAGE, isStrongPassword } from '../utils/passwordPolicy';

const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_ACCESS_KEY = process.env.ADMIN_ACCESS_KEY || '';
const ADMIN_SESSION_MAX_HOURS = Number(process.env.ADMIN_SESSION_MAX_HOURS || 8);
const ADMIN_IDLE_TIMEOUT_MINUTES = Number(process.env.ADMIN_IDLE_TIMEOUT_MINUTES || 30);

const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
};

const createAdminToken = (user: any, tokenId: string): string => {
  const payload = {
    id: (user._id as any).toString(),
    role: user.role,
    email: user.email,
    name: user.fullName,
    sessionId: tokenId,
    tokenType: 'admin',
  };
  return (jwt as any).sign(payload, JWT_SECRET, { expiresIn: `${ADMIN_SESSION_MAX_HOURS}h` });
};

const writeAuditLog = async (req: Request, adminId: string, action: string, targetType: 'user' | 'test' | 'system', targetId?: string, details?: Record<string, unknown>) => {
  await AdminAuditLog.create({
    adminId,
    action,
    targetType,
    targetId,
    details,
    ipAddress: getClientIp(req),
  });
};

export const adminLogin = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
    }

    const { email, password, accessKey } = req.body as { email?: string; password?: string; accessKey?: string };
    if (!email || !password || !accessKey) {
      return res.status(400).json({ message: 'Email, password, and access key are required.', error: 'MISSING_FIELDS' });
    }

    if (!ADMIN_ACCESS_KEY || accessKey !== ADMIN_ACCESS_KEY) {
      return res.status(401).json({ message: 'Invalid admin credentials.', error: 'INVALID_CREDENTIALS' });
    }

    const admin = await User.findOne({ email: email.toLowerCase().trim(), role: 'admin' });
    if (!admin) {
      return res.status(401).json({ message: 'Invalid admin credentials.', error: 'INVALID_CREDENTIALS' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE, error: 'WEAK_PASSWORD' });
    }

    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid admin credentials.', error: 'INVALID_CREDENTIALS' });
    }

    if (admin.status !== 'active' && admin.status !== 'approved') {
      return res.status(403).json({ message: 'Admin account is not active.', error: 'ACCOUNT_INACTIVE' });
    }

    const tokenId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MAX_HOURS * 60 * 60 * 1000);
    await AdminSession.create({
      userId: admin._id,
      tokenId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
      lastActivityAt: now,
      expiresAt,
    });

    admin.lastLoginAt = now;
    await admin.save();

    await writeAuditLog(req, (admin._id as any).toString(), 'ADMIN_LOGIN', 'system');
    const token = createAdminToken(admin, tokenId);
    return res.status(200).json({
      message: 'Admin authentication successful.',
      token,
      user: {
        id: (admin._id as any).toString(),
        name: admin.fullName,
        role: admin.role,
        email: admin.email,
      },
    });
  } catch (error: any) {
    console.error('Admin login error:', error);
    return res.status(500).json({ message: 'Admin login failed.', error: 'INTERNAL_ERROR' });
  }
};

export const authenticateAdminSession = async (req: Request, res: Response, next: Function) => {
  try {
    const authHeader = (req.headers.authorization || '') as string;
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing token', error: 'UNAUTHORIZED' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded || decoded.role !== 'admin' || !decoded.sessionId) {
      return res.status(401).json({ message: 'Invalid token', error: 'UNAUTHORIZED' });
    }

    const session = await AdminSession.findOne({ tokenId: decoded.sessionId, userId: decoded.id });
    if (!session || session.revokedAt) {
      return res.status(401).json({ message: 'Session no longer valid', error: 'SESSION_INVALID' });
    }

    const now = new Date();
    const idleMs = now.getTime() - new Date(session.lastActivityAt).getTime();
    if (idleMs > ADMIN_IDLE_TIMEOUT_MINUTES * 60 * 1000 || now > new Date(session.expiresAt)) {
      session.revokedAt = now;
      await session.save();
      return res.status(401).json({ message: 'Session expired due to inactivity.', error: 'SESSION_EXPIRED' });
    }

    session.lastActivityAt = now;
    await session.save();
    (req as any).user = decoded;
    return next();
  } catch (error: any) {
    return res.status(401).json({ message: 'Invalid or expired token.', error: 'UNAUTHORIZED' });
  }
};

export const adminLogout = async (req: Request, res: Response) => {
  const currentUser = (req as any).user;
  if (currentUser?.sessionId) {
    await AdminSession.updateOne(
      { tokenId: currentUser.sessionId, userId: currentUser.id },
      { $set: { revokedAt: new Date() } }
    );
    await writeAuditLog(req, currentUser.id, 'ADMIN_LOGOUT', 'system');
  }
  return res.status(200).json({ message: 'Logged out successfully.' });
};

export const getAdminDashboard = async (req: Request, res: Response) => {
  const [pendingExaminers, students, violations, activeSessions, recentAuditLogs] = await Promise.all([
    User.find({ role: 'examiner', status: 'pending' }).select('_id fullName email createdAt status'),
    User.find({ role: 'student' }).select('_id fullName email status createdAt').sort({ createdAt: -1 }).limit(200),
    ProctoringLog.countDocuments({ reviewed: false }),
    AdminSession.countDocuments({ revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }),
    AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(50),
  ]);

  return res.status(200).json({
    stats: {
      pendingExaminerApprovals: pendingExaminers.length,
      totalStudents: students.length,
      pendingViolations: violations,
      activeAdminSessions: activeSessions,
    },
    pendingExaminers,
    students,
    auditLogs: recentAuditLogs,
  });
};

export const approveExaminer = async (req: Request, res: Response) => {
  const { examinerId } = req.params;
  const examiner = await User.findOne({ _id: examinerId, role: 'examiner' });
  if (!examiner) return res.status(404).json({ message: 'Examiner not found', error: 'NOT_FOUND' });
  examiner.status = 'approved';
  examiner.rejectionReason = undefined;
  await examiner.save();
  await writeAuditLog(req, (req as any).user.id, 'APPROVE_EXAMINER', 'user', examinerId, { newStatus: 'approved' });
  return res.status(200).json({ message: 'Examiner approved.' });
};

export const rejectExaminer = async (req: Request, res: Response) => {
  const { examinerId } = req.params;
  const { reason } = req.body as { reason?: string };
  const examiner = await User.findOne({ _id: examinerId, role: 'examiner' });
  if (!examiner) return res.status(404).json({ message: 'Examiner not found', error: 'NOT_FOUND' });
  if (!reason || !reason.trim()) {
    return res.status(400).json({ message: 'Rejection reason is required.', error: 'MISSING_REJECTION_REASON' });
  }
  examiner.status = 'rejected';
  examiner.rejectionReason = reason.trim();
  await examiner.save();
  await writeAuditLog(req, (req as any).user.id, 'REJECT_EXAMINER', 'user', examinerId, {
    newStatus: 'rejected',
    reason: reason.trim()
  });
  return res.status(200).json({ message: 'Examiner rejected.' });
};

export const updateUserRoleStatus = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { role, status } = req.body as {
    role?: 'student' | 'examiner' | 'admin';
    status?: 'pending' | 'approved' | 'rejected' | 'active' | 'suspended';
  };

  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ message: 'User not found', error: 'NOT_FOUND' });
  const before = { role: user.role, status: user.status };
  if (role) user.role = role;
  if (status) user.status = status;
  await user.save();

  await writeAuditLog(req, (req as any).user.id, 'UPDATE_USER_ROLE_STATUS', 'user', userId, {
    before,
    after: { role: user.role, status: user.status },
  });
  return res.status(200).json({ message: 'User updated successfully.', user });
};

export const listSystemActivity = async (req: Request, res: Response) => {
  const [logs, recentAttempts] = await Promise.all([
    AdminAuditLog.find({}).sort({ createdAt: -1 }).limit(200),
    ExamAttempt.find({}).sort({ updatedAt: -1 }).limit(50).select('_id studentId testId status trustScore updatedAt'),
  ]);
  return res.status(200).json({ auditLogs: logs, recentAttempts });
};

