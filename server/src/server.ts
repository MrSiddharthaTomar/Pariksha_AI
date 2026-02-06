// server/src/server.ts
import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env file FIRST, before importing other modules
dotenv.config();

import mongoose from 'mongoose';
import jwt, { Secret } from 'jsonwebtoken';
import User from './models/User';
import Test from './models/Test';
import Violation from './models/Violation';
import Question from './models/Question';
import ExamAttempt from './models/ExamAttempt';
import ProctoringLog from './models/ProctoringLog';
import { loadFaceModels, validateFace, compareFaces } from './utils/faceRecognition';
import { processVideoChunkWithML, extractFrameFromVideo } from './utils/mlProctoring';
import { getCheatingImagesBucket } from './utils/gridfs';

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8080');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;


// --- Mock Database (Simulating data storage) ---
interface Question {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
}

interface Test {
  id: number;
  name: string;
  questions: Question[];
  status: 'scheduled' | 'completed';
  date: string;
  studentsEnrolled: number;
}

interface StudentResult {
  id: number;
  name: string;
  email: string;
  actualScore: number;
  trustScore: number;
  violationsCount: number;
}

const MOCK_DB = {
  users: [] as { id: number, fullName: string, email: string, password: string, role: 'student' | 'examiner', photo: string }[],
  // tests are now fully sourced from MongoDB; this array is kept for backward-compatible types only
  tests: [] as Test[],
  results: [
    { id: 1, name: "Alice Johnson", email: "alice@example.com", actualScore: 95, trustScore: 98, violationsCount: 0 },
    { id: 2, name: "Bob Smith", email: "bob@example.com", actualScore: 87, trustScore: 75, violationsCount: 3 },
    { id: 3, name: "Charlie Brown", email: "charlie@example.com", actualScore: 92, trustScore: 95, violationsCount: 1 },
    { id: 4, name: "Diana Prince", email: "diana@example.com", actualScore: 78, trustScore: 85, violationsCount: 2 },
    { id: 5, name: "Ethan Hunt", email: "ethan@example.com", actualScore: 89, trustScore: 92, violationsCount: 1 },
  ] as StudentResult[],
  violations: [
    { time: "10:15:23", type: "Multiple Faces Detected", severity: "high", studentId: 2, testId: 2 },
    { time: "10:22:45", type: "Looking Away", severity: "medium", studentId: 2, testId: 2 },
    { time: "10:35:12", type: "Phone Detected", severity: "high", studentId: 2, testId: 2 },
  ]
};

// --- Middleware ---
// Allows frontend running on different port (e.g., 8080) to connect
// CORS configuration - allow requests from frontend
const corsOptions = {
  origin: function (origin: string | undefined, callback: Function) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin matches CORS_ORIGIN or allow localhost for development
    if (!CORS_ORIGIN || origin === CORS_ORIGIN || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
// Parses JSON bodies, increasing limit to handle base64 videos/audio
app.use(bodyParser.json({ limit: '500mb' }));

// --- Utility Functions ---
const getNextId = (arr: any[]) => (arr.length ? Math.max(...arr.map(i => i.id)) + 1 : 1);

// JWT helpers
const generateJwtForUser = (user: any) => {
  const payload = { id: (user._id as any).toString(), role: user.role, email: user.email, name: user.fullName };
  return (jwt as any).sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const authenticateJWT = (req: Request, res: Response, next: Function) => {
  const authHeader = (req.headers['authorization'] || '') as string;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    // attach to request
    (req as any).user = decoded;
    next();
  } catch (err: any) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const requireRole = (role: string) => (req: Request, res: Response, next: Function) => {
  const user = (req as any).user;
  if (!user || user.role !== role) return res.status(403).json({ message: 'Forbidden: insufficient role' });
  next();
};


// Endpoint to trigger model loading (called from homepage)
app.get('/api/load-models', async (req: Request, res: Response) => {
  try {
    await loadFaceModels();
    res.status(200).json({ message: 'Models loaded successfully' });
  } catch (error: any) {
    res.status(500).json({
      message: 'Failed to load models',
      error: error.message
    });
  }
});

// ===============================
//         AUTH ROUTES
// ===============================

// Handles registration from StudentRegister.tsx and ExaminerRegister.tsx
app.post('/api/auth/:role/register', async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const { role } = req.params;
    const { fullName, email, password, photo } = req.body;

    // Validate input
    if (!fullName || !email || !password || !photo) {
      return res.status(400).json({
        message: 'All fields are required.',
        error: 'MISSING_FIELDS'
      });
    }

    // Validate role
    if (role !== 'student' && role !== 'examiner') {
      return res.status(400).json({
        message: 'Invalid role. Must be "student" or "examiner".',
        error: 'INVALID_ROLE'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: 'Please provide a valid email address.',
        error: 'INVALID_EMAIL'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters long.',
        error: 'INVALID_PASSWORD'
      });
    }

    // Check if user already exists in MongoDB (email must be unique globally)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        message: `User with email ${email} already exists. Please use a different email.`,
        error: 'USER_EXISTS'
      });
    }

    // Validate and extract face descriptor from photo
    const faceValidation = await validateFace(photo);
    if (!faceValidation.success || !faceValidation.descriptor) {
      return res.status(400).json({
        message: faceValidation.error || 'Face validation failed.',
        error: 'FACE_VALIDATION_FAILED',
        details: faceValidation.error
      });
    }

    // Convert Float32Array to regular array for MongoDB storage
    const faceDescriptorArray = Array.from(faceValidation.descriptor);

    // Create new user (password will be hashed by the pre-save hook)
    const newUser = new User({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role as 'student' | 'examiner',
      photo,
      faceDescriptor: faceDescriptorArray,
    });

    // Save to MongoDB
    await newUser.save();

    // Generate a token so user can be logged in immediately after registration
    const token = generateJwtForUser(newUser);

    // Return success response (don't send password or face descriptor)
    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { userId: (newUser._id as any).toString(), role: newUser.role, email: newUser.email, photo: newUser.photo }
    });
  } catch (error: any) {
    console.error('Registration error:', error);

    // Handle duplicate key error (MongoDB unique constraint)
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'User with this email already exists for this role.',
        error: 'USER_EXISTS'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0] as any;
      return res.status(400).json({
        message: firstError?.message || 'Validation failed',
        error: 'VALIDATION_ERROR'
      });
    }

    // Handle MongoDB connection errors
    if (error.name === 'MongoServerError' || error.name === 'MongoNetworkError') {
      return res.status(503).json({
        message: 'Database connection error. Please try again later.',
        error: 'DATABASE_ERROR'
      });
    }

    res.status(500).json({
      message: 'Registration failed. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
});

// Handles login from StudentLogin.tsx and ExaminerLogin.tsx
app.post('/api/auth/:role/login', async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const { role } = req.params;
    const { email, password, photo } = req.body; // 'photo' is for face verification

    // Validate input
    if (!email || !password || !photo) {
      return res.status(400).json({
        message: 'Email, password, and photo are required.',
        error: 'MISSING_FIELDS'
      });
    }

    // Validate role
    if (role !== 'student' && role !== 'examiner') {
      return res.status(400).json({
        message: 'Invalid role. Must be "student" or "examiner".',
        error: 'INVALID_ROLE'
      });
    }

    // Find user in MongoDB
    const user = await User.findOne({ email: email.toLowerCase().trim(), role });

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS'
      });
    }

    // Verify password using bcrypt comparison
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS'
      });
    }

    // Validate and extract face descriptor from login photo
    const faceValidation = await validateFace(photo);
    if (!faceValidation.success || !faceValidation.descriptor) {
      return res.status(400).json({
        message: faceValidation.error || 'Face validation failed. Please ensure your face is clearly visible.',
        error: 'FACE_DETECTION_FAILED',
        details: faceValidation.error
      });
    }

    // Verify face descriptor exists in user record
    if (!user.faceDescriptor || !Array.isArray(user.faceDescriptor) || user.faceDescriptor.length === 0) {
      return res.status(500).json({
        message: 'Face data not found for this user. Please contact support.',
        error: 'FACE_DATA_MISSING'
      });
    }

    // Compare face with stored face descriptor
    const storedDescriptor = new Float32Array(user.faceDescriptor);
    const faceMatch = compareFaces(faceValidation.descriptor, storedDescriptor);

    if (!faceMatch) {
      return res.status(401).json({
        message: 'Face verification failed. The photo does not match your registered face.',
        error: 'FACE_MISMATCH'
      });
    }

    // Success - return user info (without password or face descriptor) and a signed JWT
    const token = generateJwtForUser(user);
    res.status(200).json({
      message: 'Authentication Successful!',
      token,
      user: {
        id: (user._id as any).toString(),
        name: user.fullName,
        role: user.role,
        email: user.email,
        photo: user.photo
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);

    // Handle MongoDB connection errors
    if (error.name === 'MongoServerError' || error.name === 'MongoNetworkError') {
      return res.status(503).json({
        message: 'Database connection error. Please try again later.',
        error: 'DATABASE_ERROR'
      });
    }

    res.status(500).json({
      message: 'Login failed. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
});


// Update profile image (photo) for authenticated user
app.put('/api/auth/profile-image', authenticateJWT, async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const userId = (req as any).user.id;
    const { photo } = req.body;

    if (!photo) {
      return res.status(400).json({
        message: 'Photo is required.',
        error: 'MISSING_FIELDS'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.photo = photo;
    await user.save();

    res.status(200).json({
      message: 'Profile photo updated successfully',
      user: {
        id: (user._id as any).toString(),
        name: user.fullName,
        role: user.role,
        email: user.email,
        photo: user.photo
      }
    });
  } catch (error: any) {
    console.error('Profile image update error:', error);
    res.status(500).json({
      message: 'Failed to update profile photo.',
      error: 'INTERNAL_ERROR'
    });
  }
});


// ===============================
//         EXAMINER ROUTES
// ===============================

// Protect all /api/examiner endpoints: must present a valid JWT and be an examiner
app.use('/api/examiner', authenticateJWT, requireRole('examiner'));

// Protect all /api/student endpoints: must present a valid JWT and be a student
app.use('/api/student', authenticateJWT, requireRole('student'));

// Fetches data for ExaminerDashboard.tsx (now fully backed by MongoDB, no hardcoded tests)
app.get('/api/examiner/dashboard', async (req: Request, res: Response) => {
  try {
    const [totalTests, completedTests, scheduledTests, studentCount, recentTests] = await Promise.all([
      Test.countDocuments({}),
      Test.countDocuments({ status: 'completed' }),
      Test.countDocuments({ status: { $in: ['scheduled', 'active', 'running'] } }),
      User.countDocuments({ role: 'student' }),
      Test.find({}).sort({ createdAt: -1 }).limit(10),
    ]);

    const activeStudents = studentCount;

    // compute unreviewed proctoring logs per test
    const unreviewedAgg = await ProctoringLog.aggregate([
      { $match: { reviewed: false } },
      { $lookup: { from: 'examattempts', localField: 'attemptId', foreignField: '_id', as: 'attempt' } },
      { $unwind: '$attempt' },
      { $group: { _id: '$attempt.testId', count: { $sum: 1 } } },
    ]);

    const unreviewedMap: Record<string, number> = {};
    unreviewedAgg.forEach((r: any) => { unreviewedMap[(r._id as any).toString()] = r.count; });

    const dashboardData = {
      stats: [
        { label: 'Total Tests', value: totalTests.toString(), color: 'primary' },
        { label: 'Active Students', value: activeStudents.toString(), color: 'secondary' },
        { label: 'Completed', value: completedTests.toString(), color: 'success' },
        { label: 'Scheduled', value: scheduledTests.toString(), color: 'warning' },
      ],
      tests: recentTests.map((t) => ({
        id: (t._id as any).toString(),
        name: t.name,
        date: t.startTime ? t.startTime.toISOString().split('T')[0] : '',
        students: t.allowedStudents?.length || 0,
        status: t.status,
        startTime: t.startTime ? t.startTime.toISOString() : null,
        endTime: t.endTime ? t.endTime.toISOString() : null,
        unreviewedViolations: unreviewedMap[(t._id as any).toString()] || 0,
      })),
      unreviewedTotal: unreviewedAgg.reduce((acc: number, cur: any) => acc + (cur.count || 0), 0),
    };

    res.status(200).json(dashboardData);
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data.' });
  }
});

// Used by CreateTest.tsx to save a new test
app.post('/api/examiner/tests', async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE',
      });
    }

    const { testName, description, questions, duration, allowedStudents, examinerId, startTime, endTime } = req.body;

    if (!testName || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        message: 'Test name and questions are required.',
        error: 'MISSING_FIELDS',
      });
    }

    // Get examiner ID from request (you may need to add authentication middleware)
    const examiner = examinerId || 'unknown'; // TODO: Get from auth token

    // Determine a valid Mongo ObjectId for createdBy if possible
    let createdByObj: any = undefined;
    if (examinerId && mongoose.isValidObjectId(examinerId)) {
      createdByObj = new mongoose.Types.ObjectId(examinerId);
    }

    // Validate & sanitize submitted questions before persisting
    const sanitizedQuestions: any[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] || {};
      const type = q.type || 'mcq';
      const questionText = (q.question || q.questionText || '').toString().trim();

      if (!questionText) {
        return res.status(400).json({
          message: `Invalid question at index ${i}: text required`,
          error: 'INVALID_QUESTION',
          details: { index: i, reason: 'Question text is required' }
        });
      }

      let options: string[] = [];
      if (type === 'mcq') {
        if (!Array.isArray(q.options)) {
          return res.status(400).json({
            message: `Invalid question at index ${i}: options required for MCQ`,
            error: 'INVALID_QUESTION',
            details: { index: i, reason: 'MCQ questions require an options array' }
          });
        }
        options = q.options.map((o: any) => (o || '').toString().trim()).filter(Boolean);
        if (options.length < 2) {
          return res.status(400).json({
            message: `Invalid question at index ${i}: at least two options required`,
            error: 'INVALID_QUESTION_OPTIONS',
            details: { index: i, reason: 'MCQ questions require at least two options' }
          });
        }
      }

      const correctAnswer = type === 'mcq'
        ? (typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer < options.length ? q.correctAnswer : 0)
        : q.correctAnswer ?? null;

      sanitizedQuestions.push({
        type,
        questionText,
        options,
        correctAnswer,
        marks: typeof q.marks === 'number' ? q.marks : 1,
        sampleInput: q.sampleInput,
        sampleOutput: q.sampleOutput,
        constraints: q.constraints,
        codingStarterCode: q.codingStarterCode,
        codingFunctionSignature: q.codingFunctionSignature,
        codingTestCases: q.codingTestCases,
        subjectiveRubric: q.subjectiveRubric,
        referenceAnswer: q.referenceAnswer,
      });
    }

    // Persist reusable questions in dedicated collection and collect their IDs
    const createdQuestions = await Promise.all(
      sanitizedQuestions.map((q: any) => {
        const doc: any = {
          type: q.type,
          questionText: q.questionText,
          options: q.type === 'mcq' ? q.options : [],
          correctAnswer: q.correctAnswer,
          marks: q.marks,
          sampleInput: q.sampleInput,
          sampleOutput: q.sampleOutput,
          constraints: q.constraints,
          codingStarterCode: q.codingStarterCode,
          codingFunctionSignature: q.codingFunctionSignature,
          codingTestCases: q.codingTestCases,
          subjectiveRubric: q.subjectiveRubric,
          referenceAnswer: q.referenceAnswer,
        } as any;

        if (createdByObj) doc.createdBy = createdByObj;
        return new Question(doc).save();
      })
    );

    const questionIds = createdQuestions.map((q) => q._id);

    const start = startTime
      ? new Date(startTime)
      : new Date();
    const end = endTime
      ? new Date(endTime)
      : new Date(start.getTime() + (duration || 60) * 60 * 1000);

    // Create test in MongoDB
    const newTestData: any = {
      name: testName,
      description: description || '',
      examinerId: examiner,
      status: 'scheduled',
      duration: duration || 60, // Default 60 minutes
      questionIds,
      allowedStudents: Array.isArray(allowedStudents)
        ? allowedStudents.map((email: string) => email.toLowerCase().trim()).filter(Boolean)
        : [],
      startTime: start,
      endTime: end,
    };

    if (createdByObj) {
      newTestData.createdBy = createdByObj;
    }

    const newTest = new Test(newTestData);

    await newTest.save();

    res.status(201).json({
      message: 'Test created successfully',
      testId: (newTest._id as any).toString(),
      mongoTestId: (newTest._id as any).toString(),
    });
  } catch (error: any) {
    console.error('Create test error:', error);

    if (error.name === 'ValidationError') {
      // Extract validation messages to help the client
      const details: any = {};
      if (error.errors) {
        Object.keys(error.errors).forEach((key) => {
          details[key] = error.errors[key].message || error.errors[key];
        });
      }
      return res.status(400).json({
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        details,
      });
    }

    res.status(500).json({
      message: 'Failed to create test. Please try again.',
      error: 'INTERNAL_ERROR',
    });
  }
});

// Fetch a test with populated questions (used for editing)
app.get('/api/examiner/tests/:testId', async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    if (!mongoose.isValidObjectId(testId)) {
      return res.status(400).json({ message: 'Invalid test id provided.', error: 'INVALID_ID' });
    }

    const test = await Test.findById(testId).populate('questionIds');
    if (!test) return res.status(404).json({ message: 'Test not found' });

    const questions = (test.questionIds || []).map((q: any, idx: number) => ({
      id: (q._id as any).toString(),
      question: q.questionText,
      type: q.type,
      options: q.options || [],
      correctAnswer: q.correctAnswer ?? 0,
      marks: q.marks ?? 1,
    }));

    res.status(200).json({
      testId: (test._id as any).toString(),
      name: test.name,
      description: test.description,
      duration: test.duration,
      startTime: test.startTime,
      endTime: test.endTime,
      allowedStudents: test.allowedStudents || [],
      status: test.status,
      questions,
    });
  } catch (error: any) {
    console.error('Get test for edit error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid test id', error: 'INVALID_ID' });
    }
    res.status(500).json({ message: 'Failed to fetch test', error: error?.message });
  }
});

// List students (for scheduling tests)
app.get('/api/examiner/students', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    const students = await User.find({ role: 'student' }).select('fullName email');
    const result = (students || []).map((s: any) => ({ id: (s._id as any).toString(), name: s.fullName, email: s.email }));
    res.status(200).json({ students: result });
  } catch (error: any) {
    console.error('Fetch students error:', error);
    res.status(500).json({ message: 'Failed to fetch students', error: error?.message });
  }
});

// List live/ongoing tests for monitoring
app.get('/api/examiner/live-tests', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    const now = new Date();

    // Include tests that are explicitly active/running OR whose scheduled window includes now
    const liveTests = await Test.find({
      $or: [
        { status: { $in: ['active', 'running'] } },
        { startTime: { $lte: now }, endTime: { $gte: now } }
      ]
    }).sort({ startTime: -1 });

    // Attach count of in-progress attempts for each test
    const testsWithStats = await Promise.all(liveTests.map(async (t: any) => {
      const inProgressCount = await ExamAttempt.countDocuments({ testId: t._id, status: 'in-progress' });
      return {
        id: (t._id as any).toString(),
        name: t.name,
        startTime: t.startTime,
        endTime: t.endTime,
        students: t.allowedStudents?.length || 0,
        status: t.status,
        activeAttempts: inProgressCount,
      };
    }));

    res.status(200).json({ tests: testsWithStats });
  } catch (error: any) {
    console.error('Fetch live tests error:', error);
    res.status(500).json({ message: 'Failed to fetch live tests', error: error?.message });
  }
});

// Fetch recent proctoring events for a given test (used by the live monitor)
app.get('/api/examiner/monitor/:testId/events', async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    if (!mongoose.isValidObjectId(testId)) {
      return res.status(400).json({ message: 'Invalid test id provided', error: 'INVALID_ID' });
    }

    // Find attempts for this test (to map attempt -> student)
    const attempts = await ExamAttempt.find({ testId }).populate('studentId', 'fullName email');
    const attemptMap: Record<string, any> = {};
    attempts.forEach((a: any) => {
      attemptMap[(a._id as any).toString()] = a;
    });

    // Get recent proctoring logs (limit 200)
    const logs = await ProctoringLog.find({ attemptId: { $in: Object.keys(attemptMap) } }).sort({ timestamp: -1 }).limit(200);

    const result = logs.map((log: any) => ({
      id: (log._id as any).toString(),
      timestamp: log.timestamp,
      label: log.label,
      severity: log.severity,
      imageId: log.imageId ? (log.imageId as any).toString() : null,
      attemptId: (log.attemptId as any).toString(),
      student: attemptMap[(log.attemptId as any).toString()] ? {
        id: (attemptMap[(log.attemptId as any).toString()].studentId as any)._id?.toString(),
        name: (attemptMap[(log.attemptId as any).toString()].studentId as any).fullName,
        email: (attemptMap[(log.attemptId as any).toString()].studentId as any).email,
      } : null,
    }));

    res.status(200).json({ events: result });
  } catch (error: any) {
    console.error('Fetch monitor events error:', error);
    res.status(500).json({ message: 'Failed to fetch monitor events', error: error?.message });
  }
});

// Review a proctoring log (mark valid/invalid); adjusts attempt trust score if invalidated
app.put('/api/examiner/proctoring/:logId/review', async (req: Request, res: Response) => {
  const { logId } = req.params;
  const { verdict, reviewerId, notes } = req.body as { verdict?: 'valid' | 'invalid'; reviewerId?: string; notes?: string };

  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    if (!mongoose.isValidObjectId(logId)) {
      return res.status(400).json({ message: 'Invalid log id', error: 'INVALID_ID' });
    }

    const log = await ProctoringLog.findById(logId);
    if (!log) return res.status(404).json({ message: 'Proctoring log not found', error: 'NOT_FOUND' });

    if (!verdict || !['valid', 'invalid'].includes(verdict)) {
      return res.status(400).json({ message: 'Invalid verdict provided', error: 'INVALID_VERDICT' });
    }

    // If already reviewed with same verdict, return current state.
    if (log.reviewed && log.verdict === verdict) {
      return res.status(200).json({ message: 'Already reviewed', log });
    }

    // Map severity to penalty (must match proctor chunk logic)
    const penalty = log.severity === 'high' ? 10 : log.severity === 'medium' ? 5 : 2;

    // Capture previous verdict to decide whether to adjust attempt
    const previousVerdict = log.verdict;

    // Update log review fields
    log.reviewed = true;
    log.verdict = verdict;
    log.reviewedBy = reviewerId && mongoose.isValidObjectId(reviewerId) ? new mongoose.Types.ObjectId(reviewerId) : undefined;
    log.reviewedAt = new Date();
    if (notes) log.reviewerNotes = notes;

    // Persist changes
    await log.save();

    const attempt = await ExamAttempt.findById(log.attemptId);
    if (!attempt) {
      return res.status(500).json({ message: 'Associated attempt not found', error: 'INTERNAL_ERROR' });
    }

    // If marking invalid and it wasn't already invalid, revert previous penalty
    if (verdict === 'invalid' && previousVerdict !== 'invalid') {
      attempt.totalViolations = Math.max(0, (attempt.totalViolations || 0) - 1);
      attempt.trustScore = Math.min(100, (attempt.trustScore || 100) + penalty);
      await attempt.save();
    }

    res.status(200).json({ message: 'Review applied', log, attempt: { id: attempt._id, trustScore: attempt.trustScore, totalViolations: attempt.totalViolations } });
  } catch (error: any) {
    console.error('Review log error:', error);
    res.status(500).json({ message: 'Failed to apply review', error: error?.message });
  }
});

// Fetch live attempts (with latest frame) for a given test
app.get('/api/examiner/monitor/:testId/attempts', async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    if (!mongoose.isValidObjectId(testId)) {
      return res.status(400).json({ message: 'Invalid test id provided', error: 'INVALID_ID' });
    }

    // Return active attempts for this test (in-progress), include latest frame and student info
    const attempts = await ExamAttempt.find({ testId, status: 'in-progress' }).populate('studentId', 'fullName email');

    const result = attempts.map((a: any) => ({
      attemptId: (a._id as any).toString(),
      student: a.studentId ? { id: (a.studentId as any)._id?.toString(), name: (a.studentId as any).fullName, email: (a.studentId as any).email } : null,
      startedAt: a.startedAt,
      latestFrame: a.latestFrame || null,
      latestFrameAt: a.latestFrameAt || null,
      trustScore: a.trustScore || 100,
      totalViolations: a.totalViolations || 0,
    }));

    res.status(200).json({ attempts: result });
  } catch (error: any) {
    console.error('Fetch monitor attempts error:', error);
    res.status(500).json({ message: 'Failed to fetch monitor attempts', error: error?.message });
  }
});

// Serve proctoring image by GridFS id
app.get('/api/examiner/proctoring/images/:imageId', async (req: Request, res: Response) => {
  const { imageId } = req.params;
  try {
    // allow token via Authorization header or query param (?token=...)
    let token: string | undefined;
    const authHeader = (req.headers['authorization'] || '') as string;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
    if (!token && req.query && (req.query as any).token) token = (req.query as any).token;

    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try { jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }

    if (!mongoose.isValidObjectId(imageId)) return res.status(400).json({ message: 'Invalid image id' });
    const bucket = getCheatingImagesBucket();
    const _id = new mongoose.Types.ObjectId(imageId);
    const download = bucket.openDownloadStream(_id);
    download.on('error', (err) => {
      console.error('GridFS download error:', err);
      res.status(404).json({ message: 'Image not found' });
    });
    download.pipe(res);
  } catch (error: any) {
    console.error('Fetch image error:', error);
    res.status(500).json({ message: 'Failed to fetch image', error: error?.message });
  }
});

// Update a test
app.put('/api/examiner/tests/:testId', async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
    }

    const { testName, description, questions, duration, allowedStudents, startTime, endTime, status, examinerId } = req.body;

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    // Validate & sanitize incoming questions (same as create flow)
    if (!testName || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'Test name and questions are required.', error: 'MISSING_FIELDS' });
    }

    const sanitizedQuestions: any[] = [];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] || {};
      const type = q.type || 'mcq';
      const questionText = (q.question || q.questionText || '').toString().trim();

      if (!questionText) {
        return res.status(400).json({ message: `Invalid question at index ${i}: text required`, error: 'INVALID_QUESTION', details: { index: i } });
      }

      let options: string[] = [];
      if (type === 'mcq') {
        options = Array.isArray(q.options) ? q.options.map((o: any) => (o || '').toString().trim()).filter(Boolean) : [];
        if (options.length < 2) {
          return res.status(400).json({ message: `Invalid question at index ${i}: at least two options required`, error: 'INVALID_QUESTION_OPTIONS', details: { index: i } });
        }
      }

      const correctAnswer = type === 'mcq' ? (typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer < options.length ? q.correctAnswer : 0) : q.correctAnswer ?? null;

      sanitizedQuestions.push({ type, questionText, options, correctAnswer, marks: typeof q.marks === 'number' ? q.marks : 1 });
    }

    // Create new question docs for the updated questions
    const createdQuestions = await Promise.all(sanitizedQuestions.map((q) => new Question({ type: q.type, questionText: q.questionText, options: q.options, correctAnswer: q.correctAnswer, marks: q.marks }).save()));
    const newQuestionIds = createdQuestions.map(q => q._id);

    // Keep a copy of old question ids to clean up orphans
    const oldQuestionIds = test.questionIds ? [...test.questionIds] : [];

    // Update test fields
    test.name = testName;
    test.description = description || '';
    test.duration = duration || test.duration;
    test.allowedStudents = Array.isArray(allowedStudents) ? allowedStudents.map((e: string) => e.toLowerCase().trim()).filter(Boolean) : test.allowedStudents;
    test.startTime = startTime ? new Date(startTime) : test.startTime;
    test.endTime = endTime ? new Date(endTime) : test.endTime;
    test.status = status || test.status;
    test.questionIds = newQuestionIds;

    await test.save();

    // Clean up orphan questions from previous version
    for (const qId of oldQuestionIds) {
      const count = await Test.countDocuments({ questionIds: qId });
      if (count === 0) {
        await Question.deleteOne({ _id: qId });
      }
    }

    res.status(200).json({ message: 'Test updated successfully', testId: (test._id as any).toString() });
  } catch (error) {
    console.error('Update test error:', error);
    res.status(500).json({ message: 'Failed to update test' });
  }
});

// AI generation API for CreateTest.tsx

// AI generation API for CreateTest.tsx
app.post('/api/examiner/ai-generate', async (req: Request, res: Response) => {
  const { aiPrompt } = req.body;

  if (!aiPrompt || aiPrompt.trim().length === 0) {
    return res.status(400).json({ message: 'AI prompt is required' });
  }

  // Check if any AI API key is available
  if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
    // Fallback to mock response if no API keys are configured
    console.warn('No AI API keys configured. Using mock response.');
    const mockQuestions: Question[] = [
      { id: 1, question: "AI-Generated Q1: What is the derivative of x^2?", options: ["x", "2x", "2", "x/2"], correctAnswer: 1 },
      { id: 2, question: "AI-Generated Q2: Solve ∫(1/x) dx.", options: ["e^x", "x^2", "ln|x|", "1"], correctAnswer: 2 },
    ];

    setTimeout(() => {
      res.status(200).json({
        message: "AI generation complete (mock mode). Review questions below.",
        questions: mockQuestions
      });
    }, 1500);
    return;
  }

  try {
    let questions: Question[] = [];

    // Try OpenAI first if available
    if (OPENAI_API_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are an expert test question generator. Generate multiple choice questions in JSON format. Return only valid JSON with this structure: [{"question": "question text", "options": ["option1", "option2", "option3", "option4"], "correctAnswer": 0}] where correctAnswer is the index (0-3).'
              },
              {
                role: 'user',
                content: aiPrompt
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices[0]?.message?.content || '';
          // Try to parse JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            questions = parsed.map((q: any, idx: number) => ({
              id: idx + 1,
              question: q.question || '',
              options: q.options || ['', '', '', ''],
              correctAnswer: q.correctAnswer || 0
            }));
          }
        }
      } catch (error) {
        console.error('OpenAI API error:', error);
      }
    }

    // Fallback to Anthropic if OpenAI failed or not available
    if (questions.length === 0 && ANTHROPIC_API_KEY) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2000,
            messages: [
              {
                role: 'user',
                content: `Generate multiple choice test questions based on: ${aiPrompt}. Return JSON array format: [{"question": "text", "options": ["opt1", "opt2", "opt3", "opt4"], "correctAnswer": 0}]`
              }
            ]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.content[0]?.text || '';
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            questions = parsed.map((q: any, idx: number) => ({
              id: idx + 1,
              question: q.question || '',
              options: q.options || ['', '', '', ''],
              correctAnswer: q.correctAnswer || 0
            }));
          }
        }
      } catch (error) {
        console.error('Anthropic API error:', error);
      }
    }

    // If still no questions, return mock
    if (questions.length === 0) {
      questions = [
        { id: 1, question: "AI-Generated Q1: What is the derivative of x^2?", options: ["x", "2x", "2", "x/2"], correctAnswer: 1 },
        { id: 2, question: "AI-Generated Q2: Solve ∫(1/x) dx.", options: ["e^x", "x^2", "ln|x|", "1"], correctAnswer: 2 },
      ];
    }

    res.status(200).json({
      message: "AI generation complete. Review questions below.",
      questions: questions
    });
  } catch (error) {
    console.error('AI generation error:', error);
    res.status(500).json({ message: 'Failed to generate questions. Please try again.' });
  }
});

// Fetches results for a specific test (used by TestResults.tsx)
app.get('/api/examiner/results/:testId', async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    const test = await Test.findById(testId);
    if (!test) {
      return res.status(404).json({ message: 'Test not found' });
    }

    // Get all attempts for this test
    const attempts = await ExamAttempt.find({ testId: test._id }).populate('studentId', 'fullName email');

    const students = await Promise.all(attempts.map(async (a: any) => {
      const student = a.studentId as any;
      const violations = await ProctoringLog.countDocuments({ attemptId: a._id });
      return {
        attemptId: (a._id as any).toString(),
        studentId: (student?._id as any)?.toString() || null,
        name: student?.fullName || student?.name || 'Unknown',
        email: student?.email || 'unknown',
        actualScore: a.totalScore ?? 0,
        trustScore: a.trustScore ?? 0,
        violationsCount: a.totalViolations ?? violations ?? 0,
        status: a.status,
      };
    }));

    res.status(200).json({
      testId: (test._id as any).toString(),
      testName: test.name,
      totalStudents: test.allowedStudents?.length || students.length,
      students,
    });
  } catch (error) {
    console.error('Get test results error:', error);
    res.status(500).json({ message: 'Failed to fetch test results.' });
  }
});

// Delete a test and related data (attempts, logs, recordings). Reviewer: this is a destructive action.
app.delete('/api/examiner/tests/:testId', async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
    }

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found', error: 'NOT_FOUND' });

    // Find all attempts for this test
    const attempts = await ExamAttempt.find({ testId: test._id }).select('_id').lean();
    const attemptIds = attempts.map(a => (a._id as any));

    // Delete proctoring logs for these attempts
    if (attemptIds.length) {
      await ProctoringLog.deleteMany({ attemptId: { $in: attemptIds } });
    }

    // Delete exam attempts
    await ExamAttempt.deleteMany({ testId: test._id });

    // Delete test recordings associated with this test
    const TestRecording = (await import('./models/TestRecording')).default;
    await TestRecording.deleteMany({ testId: (test._id as any).toString() });

    // Remove the test itself
    await Test.deleteOne({ _id: test._id });

    // Clean up orphan questions: only delete Question docs that are NOT referenced by any other test
    if (test.questionIds && test.questionIds.length) {
      const QuestionModel = Question; // imported at top
      for (const qId of test.questionIds) {
        const referencingTests = await Test.countDocuments({ questionIds: qId });
        if (referencingTests === 0) {
          await QuestionModel.deleteOne({ _id: qId });
        }
      }
    }

    res.status(200).json({ message: 'Test and related data deleted successfully' });
  } catch (error) {
    console.error('Delete test error:', error);
    res.status(500).json({ message: 'Failed to delete test' });
  }
});

// Fetches detailed student report (used by StudentReport.tsx)
app.get('/api/examiner/report/:studentId/:testId', async (req: Request, res: Response) => {
  const { studentId, testId } = req.params;
  try {
    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    // Try to interpret param as attemptId first
    let attempt = await ExamAttempt.findOne({ _id: studentId, testId: test._id }).populate('studentId', 'fullName email');

    if (!attempt) {
      // Fallback to treating param as studentId (user id)
      attempt = await ExamAttempt.findOne({ testId: test._id, studentId }).populate('studentId', 'fullName email');
    }

    if (!attempt) return res.status(404).json({ message: 'Attempt not found for this student and test' });

    // Fetch proctoring logs for this attempt
    const logs = await ProctoringLog.find({ attemptId: attempt._id }).sort({ timestamp: 1 }).lean();

    res.status(200).json({
      student: {
        id: (attempt.studentId as any)?._id?.toString() || studentId,
        name: (attempt.studentId as any)?.fullName || (attempt.studentId as any)?.name || 'Unknown',
        email: (attempt.studentId as any)?.email || 'unknown',
      },
      attempt: {
        id: (attempt._id as any).toString(),
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt,
        duration: attempt.duration,
        totalScore: attempt.totalScore,
        trustScore: attempt.trustScore,
        answers: attempt.answers,
      },
      logs: logs.map((l: any) => ({
        id: (l._id as any).toString(),
        label: l.label,
        severity: l.severity,
        timestamp: l.timestamp,
        imageId: l.imageId,
      })),
    });
  } catch (error) {
    console.error('Get student report error:', error);
    res.status(500).json({ message: 'Failed to fetch report' });
  }
});

// ===============================
//         STUDENT ROUTES
// ===============================

// Get enrolled tests for a student
app.get('/api/student/tests', async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    let { studentId, email } = req.query as { studentId?: string; email?: string };

    if (!studentId && !email) {
      return res.status(400).json({
        message: 'Student ID or email is required',
        error: 'MISSING_STUDENT_IDENTIFIER'
      });
    }

    // If we have studentId but no email, try to find the user to pull their email
    if (studentId && !email) {
      const user = await User.findById(studentId);
      if (user?.email) {
        email = user.email;
      }
    }

    const normalizedEmail = email?.toLowerCase().trim();

    // Build query: tests where student is allowed via email/ID or tests open to everyone
    const statusFilter = { $in: ['scheduled', 'active', 'running'] as const };
    const query: any = { status: statusFilter };
    const accessConditions: any[] = [];
    if (studentId) {
      accessConditions.push({ allowedStudents: studentId });
    }
    if (normalizedEmail) {
      accessConditions.push({ allowedStudents: normalizedEmail });
    }
    // include open tests (no restrictions)
    accessConditions.push({ allowedStudents: { $exists: false } });
    accessConditions.push({ allowedStudents: { $size: 0 } });

    query.$or = accessConditions;

    const tests = await Test.find(query).sort({ startTime: 1 });
    const now = new Date();
    const attempts = await ExamAttempt.find({
      testId: { $in: tests.map((t) => t._id) },
      studentId,
      status: 'submitted',
    }).select('testId status');

    const attemptStatusMap = new Map<string, string>();
    attempts.forEach((attempt) => {
      attemptStatusMap.set((attempt.testId as any).toString(), attempt.status);
    });

    res.status(200).json({
      tests: tests.map(test => ({
        id: (test._id as any).toString(),
        name: test.name,
        description: test.description,
        duration: test.duration,
        status: attemptStatusMap.get((test._id as any).toString()) === 'submitted'
          ? 'submitted'
          : now < test.startTime
            ? 'scheduled'
            : now > test.endTime
              ? 'completed'
              : 'active',
        questionCount: test.questionIds?.length || 0,
        startTime: test.startTime,
        endTime: test.endTime,
      }))
    });
  } catch (error: any) {
    console.error('Get student tests error:', error);
    res.status(500).json({
      message: 'Failed to fetch tests. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
});

// Get a specific test by ID
app.get('/api/student/test/:testId', async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const { testId } = req.params;
    let { studentId, email } = req.query as { studentId?: string; email?: string };

    // If no studentId provided, use authenticated user (JWT)
    if (!studentId) {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    if (!studentId && !email) {
      return res.status(400).json({
        message: 'Student ID or email is required',
        error: 'MISSING_STUDENT_IDENTIFIER'
      });
    }

    if (studentId && !email) {
      const user = await User.findById(studentId);
      if (user?.email) {
        email = user.email;
      }
    }

    const orConditions: any[] = [];
    if (studentId) {
      orConditions.push({ allowedStudents: studentId });
    }
    if (email) {
      orConditions.push({ allowedStudents: email.toLowerCase().trim() });
    }
    orConditions.push({ allowedStudents: { $exists: false } });
    orConditions.push({ allowedStudents: { $size: 0 } });

    const test = await Test.findOne({
      _id: testId,
      ...(orConditions.length > 0 ? { $or: orConditions } : {}),
    });

    if (!test) {
      return res.status(404).json({
        message: 'Test not found or you are not enrolled in this test',
        error: 'TEST_NOT_FOUND'
      });
    }

    const now = new Date();
    if (now < test.startTime) {
      return res.status(403).json({
        message: 'This test is not yet available.',
        error: 'TEST_NOT_STARTED',
      });
    }

    if (now > test.endTime) {
      return res.status(403).json({
        message: 'This test is no longer active.',
        error: 'TEST_ENDED',
      });
    }

    if (studentId) {
      const existingAttempt = await ExamAttempt.findOne({
        testId,
        studentId,
        status: 'submitted',
      });
      if (existingAttempt) {
        return res.status(403).json({
          message: 'You have already submitted this test.',
          error: 'TEST_ALREADY_SUBMITTED',
        });
      }
    }

    const questionIds = test.questionIds || [];
    if (!questionIds.length) {
      return res.status(400).json({
        message: 'No questions configured for this test.',
        error: 'QUESTIONS_MISSING',
      });
    }

    const questionDocs = await Question.find({ _id: { $in: questionIds } });
    const questionMap = new Map(
      questionDocs.map((doc) => [(doc._id as any).toString(), doc])
    );

    const orderedQuestions = questionIds
      .map((id, index) => {
        const doc = questionMap.get((id as any).toString());
        if (!doc) return null;
        return {
          id: index + 1,
          questionId: (doc._id as any).toString(),
          type: doc.type,
          question: doc.questionText,
          options: doc.type === 'mcq' ? doc.options : [],
          marks: doc.marks || 1,
          sampleInput: doc.sampleInput,
          sampleOutput: doc.sampleOutput,
          constraints: doc.constraints,
          codingStarterCode: doc.codingStarterCode,
          codingFunctionSignature: doc.codingFunctionSignature,
          codingTestCases: doc.codingTestCases,
          subjectiveRubric: doc.subjectiveRubric,
        };
      })
      .filter(Boolean);

    // Return test without correct answers
    res.status(200).json({
      id: (test._id as any).toString(),
      name: test.name,
      description: test.description,
      duration: test.duration,
      status: test.status,
      startTime: test.startTime,
      endTime: test.endTime,
      questions: orderedQuestions,
    });
  } catch (error: any) {
    console.error('Get test error:', error);
    res.status(500).json({
      message: 'Failed to fetch test. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
});

// Helper to normalize ML violation type to ProctoringLog label
function mapViolationTypeToLabel(type: string): 'Phone Detected' | 'Multiple Faces' | 'No Person Visible' | 'Audio Detected' | 'Looking Away' {
  const lower = type.toLowerCase();
  if (lower.includes('phone')) return 'Phone Detected';
  if (lower.includes('device')) return 'Phone Detected';
  if (lower.includes('multiple') && lower.includes('face')) return 'Multiple Faces';
  if (lower.includes('no face') || lower.includes('no person')) return 'No Person Visible';
  if (lower.includes('audio')) return 'Audio Detected';
  return 'Looking Away';
}

// Endpoint to receive 10-second video chunks for real-time proctoring
app.post('/api/student/proctor-chunk', async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE',
      });
    }

    let { studentId, testId, videoChunk, timestamp } = req.body as any;

    // If studentId not provided, pull from authenticated user (JWT)
    if (!studentId) {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    // Validate required fields
    if (!studentId || !testId || !videoChunk) {
      return res.status(400).json({
        message: 'Missing required fields: studentId, testId, videoChunk',
        error: 'MISSING_FIELDS',
      });
    }

    // Convert base64 video chunk to buffer
    const videoBase64Data = videoChunk.includes(',')
      ? videoChunk.split(',')[1]
      : videoChunk.replace(/^data:video\/\w+;base64,/, '');

    const videoBuffer = Buffer.from(videoBase64Data, 'base64');

    console.log(`[PROCTOR] Processing chunk from student ${studentId} for test ${testId}`);

    // Extract frame from video for ML processing
    const frameImage = await extractFrameFromVideo(videoBuffer);

    // Process video chunk with ML model
    const mlResult = await processVideoChunkWithML(videoBuffer);

    const logTimestamp = timestamp ? new Date(timestamp) : new Date();

    // Ensure an exam attempt exists for this student & test so we can attach live frames
    let attempt = await ExamAttempt.findOne({ testId, studentId });
    if (!attempt) {
      // If the student hasn't explicitly started attempt yet, create one in-progress
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startedAt: timestamp ? new Date(timestamp) : new Date(),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
      });
      await attempt.save();
      console.log(`[PROCTOR] Created new exam attempt for student ${studentId}`);
    }

    // If we extracted a frame, attach it to the attempt for live monitoring (keeps latest snapshot)
    try {
      if (frameImage) {
        // Use .set to avoid TypeScript property mismatch on Mongoose document type
        attempt.set({ latestFrame: frameImage, latestFrameAt: logTimestamp });
        await attempt.save();
      }
    } catch (frameError) {
      console.error('[PROCTOR] Error saving latest frame on attempt:', frameError);
    }

    // If violation detected, also persist a ProctoringLog + GridFS copy of the frame
    if (mlResult.hasViolation && mlResult.violationType) {
      console.log(`[PROCTOR] Violation detected: ${mlResult.violationType} (${mlResult.severity})`);

      // Save frame as GridFS file if available
      let imageId: mongoose.Types.ObjectId | undefined;
      try {
        if (frameImage) {
          const bucket = getCheatingImagesBucket();
          const base64Data = frameImage.includes(',')
            ? frameImage.split(',')[1]
            : frameImage.replace(/^data:image\/\w+;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');

          await new Promise<void>((resolve, reject) => {
            const uploadStream = bucket.openUploadStream(`violation_${Date.now()}.jpg`, {
              metadata: {
                attemptId: attempt!._id,
                timestamp: logTimestamp,
                label: mlResult.violationType,
                severity: mlResult.severity || 'medium',
              },
            });
            uploadStream.on('error', reject);
            uploadStream.on('finish', () => {
              imageId = uploadStream.id as mongoose.Types.ObjectId;
              resolve();
            });
            uploadStream.end(imageBuffer);
          });
          console.log(`[PROCTOR] Saved violation image to GridFS`);
        }
      } catch (gridfsError) {
        console.error('[PROCTOR] Error saving proctoring image to GridFS:', gridfsError);
      }

      const label = mapViolationTypeToLabel(mlResult.violationType);
      const severity = mlResult.severity || 'medium';

      // Create proctoring log document
      const log = new ProctoringLog({
        attemptId: attempt._id,
        timestamp: logTimestamp,
        label,
        severity,
        imageId,
      });

      await log.save();
      console.log(`[PROCTOR] ✓ Logged violation: ${label} (${severity})`);

      // Update trust score and violation count on the attempt
      const penalty = severity === 'high' ? 10 : severity === 'medium' ? 5 : 2;
      attempt.totalViolations += 1;
      attempt.trustScore = Math.max(0, attempt.trustScore - penalty);
      await attempt.save();

      console.log(`⚠ Violation detected for student ${studentId}: ${mlResult.violationType} (${severity})`);

      // Return violation info (but don't block the test)
      res.status(200).json({
        message: 'Chunk processed successfully',
        violationDetected: true,
        violationType: mlResult.violationType,
        severity,
      });
    } else {
      // No violation, chunk processed and latest frame attached to attempt for live view
      console.log(`[PROCTOR] No violation in chunk from student ${studentId} (latest frame saved)`);
      res.status(200).json({
        message: 'Chunk processed successfully',
        violationDetected: false,
      });
    }
  } catch (error: any) {
    console.error('[PROCTOR] Error processing proctor chunk:', error.message);

    // Don't fail the request - just log the error
    // The test should continue even if chunk processing fails
    res.status(200).json({
      message: 'Chunk received (processing error logged)',
      violationDetected: false,
    });
  }
});

// Start or resume an exam attempt for a student (marks as 'in-progress')
app.post('/api/student/start-attempt', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId } = req.body as any;
    // If studentId not supplied, get it from JWT
    if (!studentId) {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    if (!studentId || !testId) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
    }

    // Verify test exists and is active
    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found', error: 'TEST_NOT_FOUND' });

    const now = new Date();
    if (now < test.startTime) return res.status(403).json({ message: 'Test not started yet', error: 'TEST_NOT_STARTED' });
    if (now > test.endTime) return res.status(403).json({ message: 'Test has ended', error: 'TEST_ENDED' });

    // Find or create attempt
    let attempt = await ExamAttempt.findOne({ testId, studentId });
    if (attempt && attempt.status === 'submitted') {
      return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
    }

    // Prevent start if the attempt was previously blocked due to policy violations
    if (attempt && attempt.status === 'blocked') {
      return res.status(403).json({ message: 'Attempt blocked due to policy violation (multiple monitors detected)', error: 'ATTEMPT_BLOCKED' });
    }

    if (!attempt) {
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startedAt: now,
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
      });
    } else {
      // Ensure it's marked in-progress
      attempt.status = 'in-progress';
      if (!attempt.startedAt) attempt.startedAt = now;
    }

    await attempt.save();

    res.status(200).json({ message: 'Attempt started', attemptId: (attempt._id as any).toString(), status: attempt.status });
  } catch (error: any) {
    console.error('Start attempt error:', error);
    res.status(500).json({ message: 'Failed to start attempt', error: error?.message });
  }
});

// Endpoint to record multiple-monitor detection and block the attempt when necessary
app.post('/api/student/multi-monitor-detected', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId } = req.body as any;
    if (!studentId) {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    if (!studentId || !testId) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
    }

    // Verify test exists
    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found', error: 'TEST_NOT_FOUND' });

    // Find or create an attempt and mark it blocked
    let attempt = await ExamAttempt.findOne({ testId, studentId });
    const now = new Date();

    if (!attempt) {
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'blocked',
        totalScore: 0,
        trustScore: 0,
        totalViolations: 1,
      });
    } else {
      // Increment violations and set blocked status
      attempt.totalViolations = (attempt.totalViolations || 0) + 1;
      attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - 30);
      attempt.status = 'blocked';
    }

    await attempt.save();

    // Create a proctoring log for the examiner to review
    const log = new ProctoringLog({
      attemptId: attempt._id,
      timestamp: now,
      label: 'Multiple Monitors',
      severity: 'high',
    });

    await log.save();

    return res.status(403).json({ message: 'Multiple monitors detected — attempt blocked', error: 'MULTIPLE_MONITORS_DETECTED', attemptId: (attempt._id as any).toString() });
  } catch (error: any) {
    console.error('Multi-monitor detection error:', error);
    return res.status(500).json({ message: 'Failed to record multi-monitor detection', error: error?.message });
  }
});


// Used by StudentTest.tsx to submit answers and save recording
app.post('/api/student/submit-test', async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE',
      });
    }

    const { studentId, testId, answers, startTime, endTime, violations } = req.body;

    if (!studentId || !testId || !startTime || !endTime) {
      return res.status(400).json({
        message: 'Missing required fields: studentId, testId, startTime, endTime',
        error: 'MISSING_FIELDS',
      });
    }

    const existingSubmission = await ExamAttempt.findOne({
      testId,
      studentId,
      status: 'submitted',
    });

    if (existingSubmission) {
      return res.status(409).json({
        message: 'You have already submitted this test.',
        error: 'TEST_ALREADY_SUBMITTED',
      });
    }

    const duration = Math.floor(
      (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000
    );

    // Fetch test to evaluate answers against embedded questions
    const test = await Test.findById(testId);

    let actualScore = 0;
    let questionsAttempted = 0;
    const examAnswers: {
      questionId: mongoose.Types.ObjectId;
      answer: any;
      isCorrect: boolean;
      marksObtained: number;
    }[] = [];

    let evaluationQuestions: {
      index: number;
      questionId?: mongoose.Types.ObjectId;
      type?: string;
      correctAnswer?: number;
      marks?: number;
    }[] = [];

    if (test?.questionIds?.length) {
      // Only fetch necessary fields for evaluation (optimization: select specific fields)
      const questionDocs = await Question.find(
        { _id: { $in: test.questionIds } },
        { type: 1, correctAnswer: 1, marks: 1 }
      ).lean(); // Use lean() for read-only data (faster queries)

      const questionMap = new Map(
        questionDocs.map((doc) => [(doc._id as any).toString(), doc])
      );
      evaluationQuestions = test.questionIds
        .map((id, index) => {
          const doc = questionMap.get((id as any).toString());
          if (!doc) return null;
          return {
            index: index + 1,
            questionId: id as mongoose.Types.ObjectId,
            type: doc.type,
            correctAnswer:
              doc.type === 'mcq' && typeof doc.correctAnswer === 'number'
                ? doc.correctAnswer
                : undefined,
            marks: doc.marks || 1,
          };
        })
        .filter(Boolean) as any[];
    }

    for (const q of evaluationQuestions) {
      const givenAnswer = answers ? (answers as any)[q.index] : undefined;
      if (givenAnswer !== undefined && givenAnswer !== null) {
        questionsAttempted += 1;
        let isCorrect = false;
        let marksAwarded = 0;

        if (q.type === 'mcq' && typeof q.correctAnswer === 'number') {
          isCorrect = givenAnswer === q.correctAnswer;
          marksAwarded = isCorrect ? (q.marks || 1) : 0;
        }

        actualScore += marksAwarded;

        if (q.questionId) {
          examAnswers.push({
            questionId: q.questionId,
            answer: givenAnswer,
            isCorrect,
            marksObtained: marksAwarded,
          });
        }
      }
    }

    // Ensure ExamAttempt exists and update it
    let attempt = await ExamAttempt.findOne({ testId, studentId });
    if (!attempt) {
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'submitted',
        startedAt: new Date(startTime),
        endedAt: new Date(endTime),
        duration,
        answers: examAnswers,
        totalScore: actualScore,
        trustScore: 100,
        totalViolations: violations?.length || 0,
        questionsAttempted,
      });
    } else {
      attempt.status = 'submitted';
      attempt.endedAt = new Date(endTime);
      attempt.duration = duration;
      attempt.answers = examAnswers;
      attempt.totalScore = actualScore;
      attempt.questionsAttempted = questionsAttempted;
      // Keep trustScore as is if it was already reduced by proctoring; otherwise compute simple heuristic
      if (attempt.trustScore === undefined || attempt.trustScore === null) {
        const violationCount = violations?.length || attempt.totalViolations || 0;
        attempt.trustScore = Math.max(0, 100 - violationCount * 5);
      }
    }

    const violationCount = violations?.length || attempt.totalViolations || 0;
    if (!attempt.totalViolations) {
      attempt.totalViolations = violationCount;
    }

    await attempt.save();

    // Log all violations received during submission to ProctoringLog
    if (violations && Array.isArray(violations) && violations.length > 0) {
      try {
        for (const violation of violations) {
          const label = mapViolationTypeToLabel(violation.type || '');
          const log = new ProctoringLog({
            attemptId: attempt._id,
            timestamp: violation.timestamp ? new Date(violation.timestamp) : new Date(),
            label,
            severity: violation.severity || 'medium',
          });
          await log.save();
        }
        console.log(`✓ Logged ${violations.length} violations for student ${studentId} on test ${testId}`);
      } catch (logError) {
        console.error('Error logging violations during submission:', logError);
        // Don't fail the submission due to logging errors
      }
    }

    const trustScore = attempt.trustScore;

    res.status(200).json({
      message: 'Test submitted successfully.',
      actualScore,
      trustScore,
      violationCount,
    });
  } catch (error: any) {
    console.error('Test submission error:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
      });
    }

    res.status(500).json({
      message: 'Failed to submit test. Please try again.',
      error: 'INTERNAL_ERROR',
    });
  }
});


// --- MongoDB Connection and Server Start ---
async function startServer() {
  // Load face recognition models asynchronously (non-blocking)
  // Models will be loaded when homepage is accessed or when needed
  loadFaceModels().catch((error: any) => {
    console.error('⚠ Face recognition models not loaded:', error.message);
    console.error('⚠ Face verification will not work. Please download models from:');
    console.error('⚠ https://github.com/justadudewhohacks/face-api.js-models');
    console.error('⚠ Place them in: server/models/ directory');
  });

  // Connect to MongoDB if URI is provided
  if (MONGODB_URI) {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('✓ MongoDB connected successfully');
    } catch (err: any) {
      console.error('✗ MongoDB connection error:', err);
      console.error('⚠ Server will continue but authentication will fail. Please check your MONGODB_URI in .env file.');
    }
  } else {
    console.log('⚠ MongoDB URI not configured. Please set MONGODB_URI in your .env file.');
    console.log('⚠ Authentication features will not work without MongoDB connection.');
  }

  // Start the server
  app.listen(PORT, () => {
    console.log(`\nPariksha AI Backend server is running on port ${PORT}`);
    console.log(`CORS enabled for origin: ${CORS_ORIGIN || 'Not set (check CORS_ORIGIN in .env)'}`);
    if (MONGODB_URI) {
      console.log('✓ MongoDB URI configured');
    } else {
      console.log('⚠ MongoDB URI not configured. Authentication will not work.');
    }
    if (OPENAI_API_KEY) {
      console.log('✓ OpenAI API key configured');
    }
    if (ANTHROPIC_API_KEY) {
      console.log('✓ Anthropic API key configured');
    }
    if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
      console.log('⚠ No AI API keys configured. AI generation will use mock mode.');
    }
  });
}

// Start the server
startServer();