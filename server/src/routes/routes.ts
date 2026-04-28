import express, { Request, Response, NextFunction } from "express";
import { registerUser } from '../controller/registerUser'
import { userLogin } from "../controller/userLogin";
import { authenticateJWT } from "../utils/jwt";
import { examinerDashboard, createTest, getTestDetails, getStudents, getLiveTests, getMonitorEvents, reviewProctoringLog, getMonitorAttempts, getProctoringImage, updateTest, generateQuestionsAI, getTestResults, deleteTest, getStudentReport } from "../controller/examinerController";
import { getEnrolledTests, getTestById, processProctorChunk, startAttempt, submitTest, saveProgress, recordExit, recordHeartbeat, reportMonitorRisk, logActivityEvents } from "../controller/studentController";
import { loadModels, aiGenerateTest } from "../controller/generalController";
import { updateProfilePic } from "../controller/updateProfilePic";
import {
  adminLogin,
  authenticateAdminSession,
  adminLogout,
  getAdminDashboard,
  approveExaminer,
  rejectExaminer,
  updateUserRoleStatus,
  listSystemActivity,
} from "../controller/adminController";
import { createRateLimiter } from "../middleware/rateLimit";
import User from "../models/User";

const router = express.Router();
const loginRateLimit = createRateLimiter(5, 15 * 60 * 1000);

// ============================================
// Role-based middleware
// ============================================
const requireRole = (role: string) => (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user || user.role !== role) {
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
  }
  next();
};

const requireApprovedExaminer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    if (!user?.id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const dbUser = await User.findById(user.id).select('status role rejectionReason');
    if (!dbUser || dbUser.role !== 'examiner') {
      return res.status(403).json({ message: 'Forbidden: invalid examiner account' });
    }

    if (dbUser.status !== 'approved' && dbUser.status !== 'active') {
      if (dbUser.status === 'pending') {
        return res.status(403).json({ message: 'Your examiner account is awaiting admin approval.', error: 'ACCOUNT_PENDING_APPROVAL' });
      }
      if (dbUser.status === 'rejected') {
        return res.status(403).json({
          message: `Your application has been rejected. Reason: ${dbUser.rejectionReason || 'Not specified by admin.'}`,
          error: 'ACCOUNT_REJECTED',
          rejectionReason: dbUser.rejectionReason || null,
        });
      }
      return res.status(403).json({ message: 'Your examiner account is inactive.', error: 'ACCOUNT_INACTIVE' });
    }

    return next();
  } catch (error: any) {
    return res.status(500).json({ message: 'Failed to validate examiner account.', error: 'INTERNAL_ERROR' });
  }
};

// ============================================
// General routes (no authentication required)
// ============================================
router.get('/load-models', loadModels);
router.post('/test/ai-generate', aiGenerateTest);

// ============================================
// Auth routes (no authentication required)
// ============================================
router.post('/auth/:role/register', registerUser);
router.post('/auth/:role/login', loginRateLimit, userLogin);
router.post('/admin/login', loginRateLimit, adminLogin);
router.put('/auth/profile-image', authenticateJWT, updateProfilePic);

// ============================================
// Admin routes (dedicated auth + admin role)
// ============================================
router.use('/admin', authenticateAdminSession);
router.post('/admin/logout', adminLogout);
router.get('/admin/dashboard', getAdminDashboard);
router.post('/admin/examiners/:examinerId/approve', approveExaminer);
router.post('/admin/examiners/:examinerId/reject', rejectExaminer);
router.patch('/admin/users/:userId', updateUserRoleStatus);
router.get('/admin/activity', listSystemActivity);

// ============================================
// Examiner routes (requires auth + examiner role)
// ============================================
router.use('/examiner', authenticateJWT, requireRole('examiner'), requireApprovedExaminer);

router.get('/examiner/dashboard', examinerDashboard);
router.post('/examiner/tests', createTest);
router.get('/examiner/tests/:testId', getTestDetails);
router.get('/examiner/students', getStudents);
router.get('/examiner/live-tests', getLiveTests);
router.get('/examiner/monitor/:testId/events', getMonitorEvents);
router.put('/examiner/proctoring/:logId/review', reviewProctoringLog);
router.get('/examiner/monitor/:testId/attempts', getMonitorAttempts);
router.get('/examiner/proctoring/images/:imageId', getProctoringImage);
router.put('/examiner/tests/:testId', updateTest);
router.post('/examiner/ai-generate', generateQuestionsAI);
router.get('/examiner/results/:testId', getTestResults);
router.delete('/examiner/tests/:testId', deleteTest);
router.get('/examiner/report/:studentId/:testId', getStudentReport);

// ============================================
// Student routes (requires auth + student role)
// ============================================
router.use('/student', authenticateJWT, requireRole('student'));

router.get('/student/tests', getEnrolledTests);
router.get('/student/test/:testId', getTestById);
router.post('/student/proctor-chunk', processProctorChunk);
router.post('/student/start-attempt', startAttempt);
router.post('/student/submit-test', submitTest);
router.post('/student/save-progress', saveProgress);
router.post('/student/session-exit', recordExit);
router.post('/student/heartbeat', recordHeartbeat);
router.post('/student/record-logout', recordExit);
router.post('/student/monitor-risk', reportMonitorRisk);
router.post('/student/activity-events', logActivityEvents);

export default router;