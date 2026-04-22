import express, { Request, Response, NextFunction } from "express";
import { registerUser } from '../controller/registerUser'
import { userLogin } from "../controller/userLogin";
import { authenticateJWT } from "../utils/jwt";
import { examinerDashboard, createTest, getTestDetails, getStudents, getLiveTests, getMonitorEvents, reviewProctoringLog, getMonitorAttempts, getProctoringImage, updateTest, generateQuestionsAI, getTestResults, deleteTest, getStudentReport } from "../controller/examinerController";
import { getEnrolledTests, getTestById, processProctorChunk, startAttempt, submitTest, saveProgress, recordLogout, reportMonitorRisk } from "../controller/studentController";
import { loadModels, aiGenerateTest } from "../controller/generalController";
import { updateProfilePic } from "../controller/updateProfilePic";

const router = express.Router();

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

// ============================================
// General routes (no authentication required)
// ============================================
router.get('/load-models', loadModels);
router.post('/test/ai-generate', aiGenerateTest);

// ============================================
// Auth routes (no authentication required)
// ============================================
router.post('/auth/:role/register', registerUser);
router.post('/auth/:role/login', userLogin);
router.put('/auth/profile-image', authenticateJWT, updateProfilePic);

// ============================================
// Examiner routes (requires auth + examiner role)
// ============================================
router.use('/examiner', authenticateJWT, requireRole('examiner'));

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
router.post('/student/record-logout', recordLogout);
router.post('/student/monitor-risk', reportMonitorRisk);

export default router;