"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// server/src/server.ts
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables from .env file FIRST, before importing other modules
dotenv_1.default.config();
const mongoose_1 = __importDefault(require("mongoose"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("./models/User"));
const Test_1 = __importDefault(require("./models/Test"));
const Question_1 = __importDefault(require("./models/Question"));
const ExamAttempt_1 = __importDefault(require("./models/ExamAttempt"));
const ProctoringLog_1 = __importDefault(require("./models/ProctoringLog"));
const faceRecognition_1 = require("./utils/faceRecognition");
const mlProctoring_1 = require("./utils/mlProctoring");
const gridfs_1 = require("./utils/gridfs");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8080');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;
const MOCK_DB = {
    users: [],
    // tests are now fully sourced from MongoDB; this array is kept for backward-compatible types only
    tests: [],
    results: [
        { id: 1, name: "Alice Johnson", email: "alice@example.com", actualScore: 95, trustScore: 98, violationsCount: 0 },
        { id: 2, name: "Bob Smith", email: "bob@example.com", actualScore: 87, trustScore: 75, violationsCount: 3 },
        { id: 3, name: "Charlie Brown", email: "charlie@example.com", actualScore: 92, trustScore: 95, violationsCount: 1 },
        { id: 4, name: "Diana Prince", email: "diana@example.com", actualScore: 78, trustScore: 85, violationsCount: 2 },
        { id: 5, name: "Ethan Hunt", email: "ethan@example.com", actualScore: 89, trustScore: 92, violationsCount: 1 },
    ],
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
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin)
            return callback(null, true);
        // Check if origin matches CORS_ORIGIN or allow localhost for development
        if (!CORS_ORIGIN || origin === CORS_ORIGIN || origin.includes('localhost')) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use((0, cors_1.default)(corsOptions));
// Parses JSON bodies, increasing limit to handle base64 videos/audio
app.use(body_parser_1.default.json({ limit: '500mb' }));
// --- Utility Functions ---
const getNextId = (arr) => (arr.length ? Math.max(...arr.map(i => i.id)) + 1 : 1);
// JWT helpers
const generateJwtForUser = (user) => {
    const payload = { id: user._id.toString(), role: user.role, email: user.email, name: user.fullName };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};
const authenticateJWT = (req, res, next) => {
    const authHeader = (req.headers['authorization'] || '');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Missing or invalid Authorization header' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        // attach to request
        req.user = decoded;
        next();
    }
    catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};
const requireRole = (role) => (req, res, next) => {
    const user = req.user;
    if (!user || user.role !== role)
        return res.status(403).json({ message: 'Forbidden: insufficient role' });
    next();
};
// Endpoint to trigger model loading (called from homepage)
app.get('/api/load-models', async (req, res) => {
    try {
        await (0, faceRecognition_1.loadFaceModels)();
        res.status(200).json({ message: 'Models loaded successfully' });
    }
    catch (error) {
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
app.post('/api/auth/:role/register', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose_1.default.connection.readyState !== 1) {
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
        const existingUser = await User_1.default.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(409).json({
                message: `User with email ${email} already exists. Please use a different email.`,
                error: 'USER_EXISTS'
            });
        }
        // Validate and extract face descriptor from photo
        const faceValidation = { success: true, descriptor: new Float32Array(128), error: null }; // await validateFace(photo);
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
        const newUser = new User_1.default({
            fullName: fullName.trim(),
            email: email.toLowerCase().trim(),
            password,
            role: role,
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
            user: { userId: newUser._id.toString(), role: newUser.role, email: newUser.email, photo: newUser.photo }
        });
    }
    catch (error) {
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
            const firstError = Object.values(error.errors)[0];
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
app.post('/api/auth/:role/login', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose_1.default.connection.readyState !== 1) {
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
        const user = await User_1.default.findOne({ email: email.toLowerCase().trim(), role });
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
        const faceValidation = { success: true, descriptor: new Float32Array(128), error: null }; // await validateFace(photo);
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
        const faceMatch = true; // compareFaces(faceValidation.descriptor, storedDescriptor);
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
                id: user._id.toString(),
                name: user.fullName,
                role: user.role,
                email: user.email,
                photo: user.photo
            }
        });
    }
    catch (error) {
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
app.put('/api/auth/profile-image', authenticateJWT, async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({
                message: 'Database connection not available. Please try again later.',
                error: 'DATABASE_UNAVAILABLE'
            });
        }
        const userId = req.user.id;
        const { photo } = req.body;
        if (!photo) {
            return res.status(400).json({
                message: 'Photo is required.',
                error: 'MISSING_FIELDS'
            });
        }
        const user = await User_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        user.photo = photo;
        await user.save();
        res.status(200).json({
            message: 'Profile photo updated successfully',
            user: {
                id: user._id.toString(),
                name: user.fullName,
                role: user.role,
                email: user.email,
                photo: user.photo
            }
        });
    }
    catch (error) {
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
app.get('/api/examiner/dashboard', async (req, res) => {
    try {
        const [totalTests, completedTests, scheduledTests, studentCount, recentTests] = await Promise.all([
            Test_1.default.countDocuments({}),
            Test_1.default.countDocuments({ status: 'completed' }),
            Test_1.default.countDocuments({ status: { $in: ['scheduled', 'active', 'running'] } }),
            User_1.default.countDocuments({ role: 'student' }),
            Test_1.default.find({}).sort({ createdAt: -1 }).limit(10),
        ]);
        const activeStudents = studentCount;
        // compute unreviewed proctoring logs per test
        const unreviewedAgg = await ProctoringLog_1.default.aggregate([
            { $match: { reviewed: false } },
            { $lookup: { from: 'examattempts', localField: 'attemptId', foreignField: '_id', as: 'attempt' } },
            { $unwind: '$attempt' },
            { $group: { _id: '$attempt.testId', count: { $sum: 1 } } },
        ]);
        const unreviewedMap = {};
        unreviewedAgg.forEach((r) => { unreviewedMap[r._id.toString()] = r.count; });
        const dashboardData = {
            stats: [
                { label: 'Total Tests', value: totalTests.toString(), color: 'primary' },
                { label: 'Active Students', value: activeStudents.toString(), color: 'secondary' },
                { label: 'Completed', value: completedTests.toString(), color: 'success' },
                { label: 'Scheduled', value: scheduledTests.toString(), color: 'warning' },
            ],
            tests: recentTests.map((t) => ({
                id: t._id.toString(),
                name: t.name,
                date: t.startTime ? t.startTime.toISOString().split('T')[0] : '',
                students: t.allowedStudents?.length || 0,
                status: t.status,
                startTime: t.startTime ? t.startTime.toISOString() : null,
                endTime: t.endTime ? t.endTime.toISOString() : null,
                unreviewedViolations: unreviewedMap[t._id.toString()] || 0,
            })),
            unreviewedTotal: unreviewedAgg.reduce((acc, cur) => acc + (cur.count || 0), 0),
        };
        res.status(200).json(dashboardData);
    }
    catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ message: 'Failed to fetch dashboard data.' });
    }
});
// Used by CreateTest.tsx to save a new test
app.post('/api/examiner/tests', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose_1.default.connection.readyState !== 1) {
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
        let createdByObj = undefined;
        if (examinerId && mongoose_1.default.isValidObjectId(examinerId)) {
            createdByObj = new mongoose_1.default.Types.ObjectId(examinerId);
        }
        // Validate & sanitize submitted questions before persisting
        console.log('[CreateTest] Received questions:', JSON.stringify(questions, null, 2));
        const sanitizedQuestions = [];
        for (let i = 0; i < questions.length; i++) {
            // ... existing loop code ...
        }
        console.log('[CreateTest] Sanitized questions:', JSON.stringify(sanitizedQuestions, null, 2));
        // Persist reusable questions in dedicated collection and collect their IDs
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
            let options = [];
            if (type === 'mcq') {
                if (!Array.isArray(q.options)) {
                    return res.status(400).json({
                        message: `Invalid question at index ${i}: options required for MCQ`,
                        error: 'INVALID_QUESTION',
                        details: { index: i, reason: 'MCQ questions require an options array' }
                    });
                }
                options = q.options.map((o) => (o || '').toString().trim()).filter(Boolean);
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
                codingTestCases: q.codingTestCases?.map((tc) => ({
                    input: tc.input,
                    output: tc.output,
                    explanation: tc.explanation,
                    hidden: tc.hidden
                })),
                subjectiveRubric: q.subjectiveRubric,
                referenceAnswer: q.referenceAnswer,
            });
        }
        // Persist reusable questions in dedicated collection and collect their IDs
        const createdQuestions = await Promise.all(sanitizedQuestions.map((q) => {
            const doc = {
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
            };
            if (createdByObj)
                doc.createdBy = createdByObj;
            return new Question_1.default(doc).save();
        }));
        const questionIds = createdQuestions.map((q) => q._id);
        const start = startTime
            ? new Date(startTime)
            : new Date();
        const end = endTime
            ? new Date(endTime)
            : new Date(start.getTime() + (duration || 60) * 60 * 1000);
        // Create test in MongoDB
        const newTestData = {
            name: testName,
            description: description || '',
            examinerId: examiner,
            status: 'scheduled',
            duration: duration || 60, // Default 60 minutes
            questionIds,
            allowedStudents: Array.isArray(allowedStudents)
                ? allowedStudents.map((email) => email.toLowerCase().trim()).filter(Boolean)
                : [],
            startTime: start,
            endTime: end,
        };
        if (createdByObj) {
            newTestData.createdBy = createdByObj;
        }
        const newTest = new Test_1.default(newTestData);
        await newTest.save();
        res.status(201).json({
            message: 'Test created successfully',
            testId: newTest._id.toString(),
            mongoTestId: newTest._id.toString(),
        });
    }
    catch (error) {
        console.error('Create test error:', error);
        if (error.name === 'ValidationError') {
            // Extract validation messages to help the client
            const details = {};
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
app.get('/api/examiner/tests/:testId', async (req, res) => {
    const { testId } = req.params;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        if (!mongoose_1.default.isValidObjectId(testId)) {
            return res.status(400).json({ message: 'Invalid test id provided.', error: 'INVALID_ID' });
        }
        const test = await Test_1.default.findById(testId).populate('questionIds');
        if (!test)
            return res.status(404).json({ message: 'Test not found' });
        const questions = (test.questionIds || []).map((q, idx) => ({
            id: q._id.toString(),
            question: q.questionText,
            type: q.type,
            options: q.options || [],
            correctAnswer: q.correctAnswer ?? 0,
            marks: q.marks ?? 1,
        }));
        res.status(200).json({
            testId: test._id.toString(),
            name: test.name,
            description: test.description,
            duration: test.duration,
            startTime: test.startTime,
            endTime: test.endTime,
            allowedStudents: test.allowedStudents || [],
            status: test.status,
            questions,
        });
    }
    catch (error) {
        console.error('Get test for edit error:', error);
        if (error.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid test id', error: 'INVALID_ID' });
        }
        res.status(500).json({ message: 'Failed to fetch test', error: error?.message });
    }
});
// List students (for scheduling tests)
app.get('/api/examiner/students', async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        const students = await User_1.default.find({ role: 'student' }).select('fullName email');
        const result = (students || []).map((s) => ({ id: s._id.toString(), name: s.fullName, email: s.email }));
        res.status(200).json({ students: result });
    }
    catch (error) {
        console.error('Fetch students error:', error);
        res.status(500).json({ message: 'Failed to fetch students', error: error?.message });
    }
});
// List live/ongoing tests for monitoring
app.get('/api/examiner/live-tests', async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        const now = new Date();
        // Include tests that are explicitly active/running OR whose scheduled window includes now
        const liveTests = await Test_1.default.find({
            $or: [
                { status: { $in: ['active', 'running'] } },
                { startTime: { $lte: now }, endTime: { $gte: now } }
            ]
        }).sort({ startTime: -1 });
        // Attach count of in-progress attempts for each test
        const testsWithStats = await Promise.all(liveTests.map(async (t) => {
            const inProgressCount = await ExamAttempt_1.default.countDocuments({ testId: t._id, status: 'in-progress' });
            return {
                id: t._id.toString(),
                name: t.name,
                startTime: t.startTime,
                endTime: t.endTime,
                students: t.allowedStudents?.length || 0,
                status: t.status,
                activeAttempts: inProgressCount,
            };
        }));
        res.status(200).json({ tests: testsWithStats });
    }
    catch (error) {
        console.error('Fetch live tests error:', error);
        res.status(500).json({ message: 'Failed to fetch live tests', error: error?.message });
    }
});
// Fetch recent proctoring events for a given test (used by the live monitor)
app.get('/api/examiner/monitor/:testId/events', async (req, res) => {
    const { testId } = req.params;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        if (!mongoose_1.default.isValidObjectId(testId)) {
            return res.status(400).json({ message: 'Invalid test id provided', error: 'INVALID_ID' });
        }
        // Find attempts for this test (to map attempt -> student)
        const attempts = await ExamAttempt_1.default.find({ testId }).populate('studentId', 'fullName email');
        const attemptMap = {};
        attempts.forEach((a) => {
            attemptMap[a._id.toString()] = a;
        });
        // Get recent proctoring logs (limit 200)
        const logs = await ProctoringLog_1.default.find({ attemptId: { $in: Object.keys(attemptMap) } }).sort({ timestamp: -1 }).limit(200);
        const result = logs.map((log) => ({
            id: log._id.toString(),
            timestamp: log.timestamp,
            label: log.label,
            severity: log.severity,
            imageId: log.imageId ? log.imageId.toString() : null,
            attemptId: log.attemptId.toString(),
            student: attemptMap[log.attemptId.toString()] ? {
                id: attemptMap[log.attemptId.toString()].studentId._id?.toString(),
                name: attemptMap[log.attemptId.toString()].studentId.fullName,
                email: attemptMap[log.attemptId.toString()].studentId.email,
            } : null,
        }));
        res.status(200).json({ events: result });
    }
    catch (error) {
        console.error('Fetch monitor events error:', error);
        res.status(500).json({ message: 'Failed to fetch monitor events', error: error?.message });
    }
});
// Review a proctoring log (mark valid/invalid); adjusts attempt trust score if invalidated
app.put('/api/examiner/proctoring/:logId/review', async (req, res) => {
    const { logId } = req.params;
    const { verdict, reviewerId, notes } = req.body;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        if (!mongoose_1.default.isValidObjectId(logId)) {
            return res.status(400).json({ message: 'Invalid log id', error: 'INVALID_ID' });
        }
        const log = await ProctoringLog_1.default.findById(logId);
        if (!log)
            return res.status(404).json({ message: 'Proctoring log not found', error: 'NOT_FOUND' });
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
        log.reviewedBy = reviewerId && mongoose_1.default.isValidObjectId(reviewerId) ? new mongoose_1.default.Types.ObjectId(reviewerId) : undefined;
        log.reviewedAt = new Date();
        if (notes)
            log.reviewerNotes = notes;
        // Persist changes
        await log.save();
        const attempt = await ExamAttempt_1.default.findById(log.attemptId);
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
    }
    catch (error) {
        console.error('Review log error:', error);
        res.status(500).json({ message: 'Failed to apply review', error: error?.message });
    }
});
// Fetch live attempts (with latest frame) for a given test
app.get('/api/examiner/monitor/:testId/attempts', async (req, res) => {
    const { testId } = req.params;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        if (!mongoose_1.default.isValidObjectId(testId)) {
            return res.status(400).json({ message: 'Invalid test id provided', error: 'INVALID_ID' });
        }
        // Return active attempts for this test (in-progress), include latest frame and student info
        const attempts = await ExamAttempt_1.default.find({ testId, status: 'in-progress' }).populate('studentId', 'fullName email');
        const result = attempts.map((a) => ({
            attemptId: a._id.toString(),
            student: a.studentId ? { id: a.studentId._id?.toString(), name: a.studentId.fullName, email: a.studentId.email } : null,
            startedAt: a.startedAt,
            latestFrame: a.latestFrame || null,
            latestFrameAt: a.latestFrameAt || null,
            trustScore: a.trustScore || 100,
            totalViolations: a.totalViolations || 0,
        }));
        res.status(200).json({ attempts: result });
    }
    catch (error) {
        console.error('Fetch monitor attempts error:', error);
        res.status(500).json({ message: 'Failed to fetch monitor attempts', error: error?.message });
    }
});
// Serve proctoring image by GridFS id
app.get('/api/examiner/proctoring/images/:imageId', async (req, res) => {
    const { imageId } = req.params;
    try {
        // allow token via Authorization header or query param (?token=...)
        let token;
        const authHeader = (req.headers['authorization'] || '');
        if (authHeader && authHeader.startsWith('Bearer '))
            token = authHeader.split(' ')[1];
        if (!token && req.query && req.query.token)
            token = req.query.token;
        if (!token)
            return res.status(401).json({ message: 'Unauthorized' });
        try {
            jsonwebtoken_1.default.verify(token, JWT_SECRET);
        }
        catch (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }
        if (!mongoose_1.default.isValidObjectId(imageId))
            return res.status(400).json({ message: 'Invalid image id' });
        const bucket = (0, gridfs_1.getCheatingImagesBucket)();
        const _id = new mongoose_1.default.Types.ObjectId(imageId);
        const download = bucket.openDownloadStream(_id);
        download.on('error', (err) => {
            console.error('GridFS download error:', err);
            res.status(404).json({ message: 'Image not found' });
        });
        download.pipe(res);
    }
    catch (error) {
        console.error('Fetch image error:', error);
        res.status(500).json({ message: 'Failed to fetch image', error: error?.message });
    }
});
// Get a specific test for editing (Examiner only)
app.get('/api/examiner/tests/:testId', async (req, res) => {
    const { testId } = req.params;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
        }
        const test = await Test_1.default.findById(testId);
        if (!test)
            return res.status(404).json({ message: 'Test not found' });
        // Fetch questions
        const questionIds = test.questionIds || [];
        const questionDocs = await Question_1.default.find({ _id: { $in: questionIds } });
        console.log(`[EditTest] TestId: ${testId}, Found ${questionDocs.length} questions`);
        // Maintain order
        const questionMap = new Map(questionDocs.map((q) => [q._id.toString(), q]));
        const questions = questionIds.map((id) => {
            const q = questionMap.get(id.toString());
            if (!q)
                return null;
            const qObj = q.toObject();
            if (q.type === 'coding') {
                console.log(`[EditTest] Question ${q._id}: codingTestCases count = ${qObj.codingTestCases?.length}`);
            }
            return {
                ...qObj,
                question: q.questionText, // Client expects 'question' or 'questionText'
            };
        }).filter(Boolean);
        res.status(200).json({
            ...test.toObject(),
            questions
        });
    }
    catch (error) {
        console.error('Fetch test for edit error:', error);
        res.status(500).json({ message: 'Failed to fetch test' });
    }
});
// Update a test
app.put('/api/examiner/tests/:testId', async (req, res) => {
    const { testId } = req.params;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
        }
        const { testName, description, questions, duration, allowedStudents, startTime, endTime, status, examinerId } = req.body;
        const test = await Test_1.default.findById(testId);
        if (!test)
            return res.status(404).json({ message: 'Test not found' });
        // Validate & sanitize incoming questions (same as create flow)
        if (!testName || !questions || !Array.isArray(questions) || questions.length === 0) {
            return res.status(400).json({ message: 'Test name and questions are required.', error: 'MISSING_FIELDS' });
        }
        const sanitizedQuestions = [];
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i] || {};
            const type = q.type || 'mcq';
            const questionText = (q.question || q.questionText || '').toString().trim();
            if (!questionText) {
                return res.status(400).json({ message: `Invalid question at index ${i}: text required`, error: 'INVALID_QUESTION', details: { index: i } });
            }
            let options = [];
            if (type === 'mcq') {
                options = Array.isArray(q.options) ? q.options.map((o) => (o || '').toString().trim()).filter(Boolean) : [];
                if (options.length < 2) {
                    return res.status(400).json({ message: `Invalid question at index ${i}: at least two options required`, error: 'INVALID_QUESTION_OPTIONS', details: { index: i } });
                }
            }
            const correctAnswer = type === 'mcq' ? (typeof q.correctAnswer === 'number' && q.correctAnswer >= 0 && q.correctAnswer < options.length ? q.correctAnswer : 0) : q.correctAnswer ?? null;
            sanitizedQuestions.push({ type, questionText, options, correctAnswer, marks: typeof q.marks === 'number' ? q.marks : 1 });
        }
        // Create new question docs for the updated questions
        const createdQuestions = await Promise.all(sanitizedQuestions.map((q) => new Question_1.default({ type: q.type, questionText: q.questionText, options: q.options, correctAnswer: q.correctAnswer, marks: q.marks }).save()));
        const newQuestionIds = createdQuestions.map(q => q._id);
        // Keep a copy of old question ids to clean up orphans
        const oldQuestionIds = test.questionIds ? [...test.questionIds] : [];
        // Update test fields
        test.name = testName;
        test.description = description || '';
        test.duration = duration || test.duration;
        test.allowedStudents = Array.isArray(allowedStudents) ? allowedStudents.map((e) => e.toLowerCase().trim()).filter(Boolean) : test.allowedStudents;
        test.startTime = startTime ? new Date(startTime) : test.startTime;
        test.endTime = endTime ? new Date(endTime) : test.endTime;
        test.status = status || test.status;
        test.questionIds = newQuestionIds;
        await test.save();
        // Clean up orphan questions from previous version
        for (const qId of oldQuestionIds) {
            const count = await Test_1.default.countDocuments({ questionIds: qId });
            if (count === 0) {
                await Question_1.default.deleteOne({ _id: qId });
            }
        }
        res.status(200).json({ message: 'Test updated successfully', testId: test._id.toString() });
    }
    catch (error) {
        console.error('Update test error:', error);
        res.status(500).json({ message: 'Failed to update test' });
    }
});
// AI generation API for CreateTest.tsx
// AI generation API for CreateTest.tsx
app.post('/api/examiner/ai-generate', async (req, res) => {
    const { aiPrompt } = req.body;
    if (!aiPrompt || aiPrompt.trim().length === 0) {
        return res.status(400).json({ message: 'AI prompt is required' });
    }
    // Check if any AI API key is available
    if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
        // Fallback to mock response if no API keys are configured
        console.warn('No AI API keys configured. Using mock response.');
        const mockQuestions = [
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
        let questions = [];
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
                        questions = parsed.map((q, idx) => ({
                            id: idx + 1,
                            question: q.question || '',
                            options: q.options || ['', '', '', ''],
                            correctAnswer: q.correctAnswer || 0
                        }));
                    }
                }
            }
            catch (error) {
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
                        questions = parsed.map((q, idx) => ({
                            id: idx + 1,
                            question: q.question || '',
                            options: q.options || ['', '', '', ''],
                            correctAnswer: q.correctAnswer || 0
                        }));
                    }
                }
            }
            catch (error) {
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
    }
    catch (error) {
        console.error('AI generation error:', error);
        res.status(500).json({ message: 'Failed to generate questions. Please try again.' });
    }
});
// Fetches results for a specific test (used by TestResults.tsx)
app.get('/api/examiner/results/:testId', async (req, res) => {
    const { testId } = req.params;
    try {
        const test = await Test_1.default.findById(testId);
        if (!test) {
            return res.status(404).json({ message: 'Test not found' });
        }
        // Get all attempts for this test
        const attempts = await ExamAttempt_1.default.find({ testId: test._id }).populate('studentId', 'fullName email');
        const students = await Promise.all(attempts.map(async (a) => {
            const student = a.studentId;
            const violations = await ProctoringLog_1.default.countDocuments({ attemptId: a._id });
            return {
                attemptId: a._id.toString(),
                studentId: student?._id?.toString() || null,
                name: student?.fullName || student?.name || 'Unknown',
                email: student?.email || 'unknown',
                actualScore: a.totalScore ?? 0,
                trustScore: a.trustScore ?? 0,
                violationsCount: a.totalViolations ?? violations ?? 0,
                status: a.status,
            };
        }));
        res.status(200).json({
            testId: test._id.toString(),
            testName: test.name,
            totalStudents: test.allowedStudents?.length || students.length,
            students,
        });
    }
    catch (error) {
        console.error('Get test results error:', error);
        res.status(500).json({ message: 'Failed to fetch test results.' });
    }
});
// Delete a test and related data (attempts, logs, recordings). Reviewer: this is a destructive action.
app.delete('/api/examiner/tests/:testId', async (req, res) => {
    const { testId } = req.params;
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
        }
        const test = await Test_1.default.findById(testId);
        if (!test)
            return res.status(404).json({ message: 'Test not found', error: 'NOT_FOUND' });
        // Find all attempts for this test
        const attempts = await ExamAttempt_1.default.find({ testId: test._id }).select('_id').lean();
        const attemptIds = attempts.map(a => a._id);
        // Delete proctoring logs for these attempts
        if (attemptIds.length) {
            await ProctoringLog_1.default.deleteMany({ attemptId: { $in: attemptIds } });
        }
        // Delete exam attempts
        await ExamAttempt_1.default.deleteMany({ testId: test._id });
        // Delete test recordings associated with this test
        const TestRecording = (await Promise.resolve().then(() => __importStar(require('./models/TestRecording')))).default;
        await TestRecording.deleteMany({ testId: test._id.toString() });
        // Remove the test itself
        await Test_1.default.deleteOne({ _id: test._id });
        // Clean up orphan questions: only delete Question docs that are NOT referenced by any other test
        if (test.questionIds && test.questionIds.length) {
            const QuestionModel = Question_1.default; // imported at top
            for (const qId of test.questionIds) {
                const referencingTests = await Test_1.default.countDocuments({ questionIds: qId });
                if (referencingTests === 0) {
                    await QuestionModel.deleteOne({ _id: qId });
                }
            }
        }
        res.status(200).json({ message: 'Test and related data deleted successfully' });
    }
    catch (error) {
        console.error('Delete test error:', error);
        res.status(500).json({ message: 'Failed to delete test' });
    }
});
// Fetches detailed student report (used by StudentReport.tsx)
app.get('/api/examiner/report/:studentId/:testId', async (req, res) => {
    const { studentId, testId } = req.params;
    try {
        const test = await Test_1.default.findById(testId);
        if (!test)
            return res.status(404).json({ message: 'Test not found' });
        // Try to interpret param as attemptId first
        let attempt = await ExamAttempt_1.default.findOne({ _id: studentId, testId: test._id }).populate('studentId', 'fullName email');
        if (!attempt) {
            // Fallback to treating param as studentId (user id)
            attempt = await ExamAttempt_1.default.findOne({ testId: test._id, studentId }).populate('studentId', 'fullName email');
        }
        if (!attempt)
            return res.status(404).json({ message: 'Attempt not found for this student and test' });
        // Fetch proctoring logs for this attempt
        const logs = await ProctoringLog_1.default.find({ attemptId: attempt._id }).sort({ timestamp: 1 }).lean();
        res.status(200).json({
            student: {
                id: attempt.studentId?._id?.toString() || studentId,
                name: attempt.studentId?.fullName || attempt.studentId?.name || 'Unknown',
                email: attempt.studentId?.email || 'unknown',
            },
            attempt: {
                id: attempt._id.toString(),
                startedAt: attempt.startedAt,
                endedAt: attempt.endedAt,
                duration: attempt.duration,
                totalScore: attempt.totalScore,
                trustScore: attempt.trustScore,
                answers: attempt.answers,
            },
            logs: logs.map((l) => ({
                id: l._id.toString(),
                label: l.label,
                severity: l.severity,
                timestamp: l.timestamp,
                imageId: l.imageId,
            })),
        });
    }
    catch (error) {
        console.error('Get student report error:', error);
        res.status(500).json({ message: 'Failed to fetch report' });
    }
});
// ===============================
//         STUDENT ROUTES
// ===============================
// Get enrolled tests for a student
app.get('/api/student/tests', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({
                message: 'Database connection not available. Please try again later.',
                error: 'DATABASE_UNAVAILABLE'
            });
        }
        let { studentId, email } = req.query;
        if (!studentId && !email) {
            return res.status(400).json({
                message: 'Student ID or email is required',
                error: 'MISSING_STUDENT_IDENTIFIER'
            });
        }
        // If we have studentId but no email, try to find the user to pull their email
        if (studentId && !email) {
            const user = await User_1.default.findById(studentId);
            if (user?.email) {
                email = user.email;
            }
        }
        const normalizedEmail = email?.toLowerCase().trim();
        // Build query: tests where student is allowed via email/ID or tests open to everyone
        const statusFilter = { $in: ['scheduled', 'active', 'running'] };
        const query = { status: statusFilter };
        const accessConditions = [];
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
        const tests = await Test_1.default.find(query).sort({ startTime: 1 });
        const now = new Date();
        const attempts = await ExamAttempt_1.default.find({
            testId: { $in: tests.map((t) => t._id) },
            studentId,
            status: 'submitted',
        }).select('testId status');
        const attemptStatusMap = new Map();
        attempts.forEach((attempt) => {
            attemptStatusMap.set(attempt.testId.toString(), attempt.status);
        });
        res.status(200).json({
            tests: tests.map(test => ({
                id: test._id.toString(),
                name: test.name,
                description: test.description,
                duration: test.duration,
                status: attemptStatusMap.get(test._id.toString()) === 'submitted'
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
    }
    catch (error) {
        console.error('Get student tests error:', error);
        res.status(500).json({
            message: 'Failed to fetch tests. Please try again.',
            error: 'INTERNAL_ERROR'
        });
    }
});
// Get a specific test by ID
app.get('/api/student/test/:testId', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({
                message: 'Database connection not available. Please try again later.',
                error: 'DATABASE_UNAVAILABLE'
            });
        }
        const { testId } = req.params;
        let { studentId, email } = req.query;
        // If no studentId provided, use authenticated user (JWT)
        if (!studentId) {
            const user = req.user;
            if (user && user.id)
                studentId = user.id;
        }
        if (!studentId && !email) {
            return res.status(400).json({
                message: 'Student ID or email is required',
                error: 'MISSING_STUDENT_IDENTIFIER'
            });
        }
        if (studentId && !email) {
            const user = await User_1.default.findById(studentId);
            if (user?.email) {
                email = user.email;
            }
        }
        const orConditions = [];
        if (studentId) {
            orConditions.push({ allowedStudents: studentId });
        }
        if (email) {
            orConditions.push({ allowedStudents: email.toLowerCase().trim() });
        }
        orConditions.push({ allowedStudents: { $exists: false } });
        orConditions.push({ allowedStudents: { $size: 0 } });
        const test = await Test_1.default.findOne({
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
            const existingAttempt = await ExamAttempt_1.default.findOne({
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
        const questionDocs = await Question_1.default.find({ _id: { $in: questionIds } });
        const questionMap = new Map(questionDocs.map((doc) => [doc._id.toString(), doc]));
        const orderedQuestions = questionIds
            .map((id, index) => {
            const doc = questionMap.get(id.toString());
            if (!doc)
                return null;
            return {
                id: index + 1,
                questionId: doc._id.toString(),
                type: doc.type,
                question: doc.questionText,
                options: doc.type === 'mcq' ? doc.options : [],
                marks: doc.marks || 1,
                sampleInput: doc.sampleInput,
                sampleOutput: doc.sampleOutput,
                constraints: doc.constraints,
                codingStarterCode: doc.codingStarterCode,
                codingFunctionSignature: doc.codingFunctionSignature,
                codingTestCases: (doc.codingTestCases || []).map((tc) => ({
                    input: tc.hidden ? '[Hidden]' : tc.input,
                    output: tc.hidden ? '[Hidden]' : tc.output,
                    hidden: tc.hidden
                })),
                subjectiveRubric: doc.subjectiveRubric,
            };
        })
            .filter(Boolean);
        // Return test without correct answers
        res.status(200).json({
            id: test._id.toString(),
            name: test.name,
            description: test.description,
            duration: test.duration,
            status: test.status,
            startTime: test.startTime,
            endTime: test.endTime,
            questions: orderedQuestions,
        });
    }
    catch (error) {
        console.error('Get test error:', error);
        res.status(500).json({
            message: 'Failed to fetch test. Please try again.',
            error: 'INTERNAL_ERROR'
        });
    }
});
// Helper to normalize ML violation type to ProctoringLog label
function mapViolationTypeToLabel(type) {
    const lower = type.toLowerCase();
    if (lower.includes('phone'))
        return 'Phone Detected';
    if (lower.includes('device'))
        return 'Phone Detected';
    if (lower.includes('multiple') && lower.includes('face'))
        return 'Multiple Faces';
    if (lower.includes('no face') || lower.includes('no person'))
        return 'No Person Visible';
    if (lower.includes('audio'))
        return 'Audio Detected';
    return 'Looking Away';
}
// Endpoint to receive 10-second video chunks for real-time proctoring
app.post('/api/student/proctor-chunk', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({
                message: 'Database connection not available. Please try again later.',
                error: 'DATABASE_UNAVAILABLE',
            });
        }
        let { studentId, testId, videoChunk, timestamp } = req.body;
        // If studentId not provided, pull from authenticated user (JWT)
        if (!studentId) {
            const user = req.user;
            if (user && user.id)
                studentId = user.id;
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
        const frameImage = await (0, mlProctoring_1.extractFrameFromVideo)(videoBuffer);
        // Process video chunk with ML model
        const mlResult = await (0, mlProctoring_1.processVideoChunkWithML)(videoBuffer);
        const logTimestamp = timestamp ? new Date(timestamp) : new Date();
        // Ensure an exam attempt exists for this student & test so we can attach live frames
        let attempt = await ExamAttempt_1.default.findOne({ testId, studentId });
        if (!attempt) {
            // If the student hasn't explicitly started attempt yet, create one in-progress
            attempt = new ExamAttempt_1.default({
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
        }
        catch (frameError) {
            console.error('[PROCTOR] Error saving latest frame on attempt:', frameError);
        }
        // If violation detected, also persist a ProctoringLog + GridFS copy of the frame
        if (mlResult.hasViolation && mlResult.violationType) {
            console.log(`[PROCTOR] Violation detected: ${mlResult.violationType} (${mlResult.severity})`);
            // Save frame as GridFS file if available
            let imageId;
            try {
                if (frameImage) {
                    const bucket = (0, gridfs_1.getCheatingImagesBucket)();
                    const base64Data = frameImage.includes(',')
                        ? frameImage.split(',')[1]
                        : frameImage.replace(/^data:image\/\w+;base64,/, '');
                    const imageBuffer = Buffer.from(base64Data, 'base64');
                    await new Promise((resolve, reject) => {
                        const uploadStream = bucket.openUploadStream(`violation_${Date.now()}.jpg`, {
                            metadata: {
                                attemptId: attempt._id,
                                timestamp: logTimestamp,
                                label: mlResult.violationType,
                                severity: mlResult.severity || 'medium',
                            },
                        });
                        uploadStream.on('error', reject);
                        uploadStream.on('finish', () => {
                            imageId = uploadStream.id;
                            resolve();
                        });
                        uploadStream.end(imageBuffer);
                    });
                    console.log(`[PROCTOR] Saved violation image to GridFS`);
                }
            }
            catch (gridfsError) {
                console.error('[PROCTOR] Error saving proctoring image to GridFS:', gridfsError);
            }
            const label = mapViolationTypeToLabel(mlResult.violationType);
            const severity = mlResult.severity || 'medium';
            // Create proctoring log document
            const log = new ProctoringLog_1.default({
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
        }
        else {
            // No violation, chunk processed and latest frame attached to attempt for live view
            console.log(`[PROCTOR] No violation in chunk from student ${studentId} (latest frame saved)`);
            res.status(200).json({
                message: 'Chunk processed successfully',
                violationDetected: false,
            });
        }
    }
    catch (error) {
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
app.post('/api/student/start-attempt', async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        let { studentId, testId } = req.body;
        // If studentId not supplied, get it from JWT
        if (!studentId) {
            const user = req.user;
            if (user && user.id)
                studentId = user.id;
        }
        if (!studentId || !testId) {
            return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
        }
        // Verify test exists and is active
        const test = await Test_1.default.findById(testId);
        if (!test)
            return res.status(404).json({ message: 'Test not found', error: 'TEST_NOT_FOUND' });
        const now = new Date();
        if (now < test.startTime)
            return res.status(403).json({ message: 'Test not started yet', error: 'TEST_NOT_STARTED' });
        if (now > test.endTime)
            return res.status(403).json({ message: 'Test has ended', error: 'TEST_ENDED' });
        // Find or create attempt
        let attempt = await ExamAttempt_1.default.findOne({ testId, studentId });
        if (attempt && attempt.status === 'submitted') {
            return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
        }
        // Prevent start if the attempt was previously blocked due to policy violations
        if (attempt && attempt.status === 'blocked') {
            return res.status(403).json({ message: 'Attempt blocked due to policy violation (multiple monitors detected)', error: 'ATTEMPT_BLOCKED' });
        }
        if (!attempt) {
            attempt = new ExamAttempt_1.default({
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
        }
        else {
            // Ensure it's marked in-progress
            attempt.status = 'in-progress';
            if (!attempt.startedAt)
                attempt.startedAt = now;
        }
        await attempt.save();
        res.status(200).json({ message: 'Attempt started', attemptId: attempt._id.toString(), status: attempt.status });
    }
    catch (error) {
        console.error('Start attempt error:', error);
        res.status(500).json({ message: 'Failed to start attempt', error: error?.message });
    }
});
// Submit a test attempt
app.post('/api/student/submit-test', async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
        }
        const { studentId, testId, answers, startTime, endTime, violations } = req.body;
        if (!studentId || !testId || !answers) {
            return res.status(400).json({ message: 'Missing required submission fields', error: 'MISSING_FIELDS' });
        }
        // Try to find existing attempt first to avoid duplicates if possible, though schema handles unique
        let attempt = await ExamAttempt_1.default.findOne({ studentId, testId });
        if (!attempt) {
            // Should ideally exist if 'start-test' was called, but if not create one
            attempt = new ExamAttempt_1.default({
                studentId,
                testId,
                startedAt: startTime ? new Date(startTime) : new Date(),
                status: 'in-progress'
            });
        }
        // Process answers - calculate score for MCQs
        // We need to fetch the test questions to grade
        const test = await Test_1.default.findById(testId).populate('questionIds');
        if (!test)
            return res.status(404).json({ message: 'Test not found' });
        const questionsMap = {};
        test.questionIds.forEach((q) => {
            questionsMap[q._id.toString()] = q;
        });
        let totalScore = 0;
        const processedAnswers = Object.keys(answers).map((qId) => {
            const question = questionsMap[qId];
            if (!question)
                return null; // Should not happen
            const submittedAns = answers[qId];
            // Auto-grade MCQ
            let isCorrect = false;
            let marksObtained = 0;
            if (question.type === 'mcq') {
                // Compare with correct answer (index)
                // Assuming question.correctAnswer is the index number
                if (Number(submittedAns) === Number(question.correctAnswer)) {
                    isCorrect = true;
                    marksObtained = question.marks || 1;
                }
            }
            else if (question.type === 'coding') {
                // Coding questions are not auto-graded here (future improvement: run test cases server side)
                // For now, mark as needs grading or null
                isCorrect = false;
                marksObtained = 0; // Or partial
            }
            totalScore += marksObtained;
            return {
                questionId: question._id,
                answer: submittedAns,
                isCorrect,
                marksObtained
            };
        }).filter(Boolean);
        // Save final attempt
        attempt.status = 'submitted';
        attempt.endedAt = endTime ? new Date(endTime) : new Date();
        attempt.answers = processedAnswers;
        attempt.totalScore = totalScore;
        attempt.questionsAttempted = processedAnswers.length;
        // Process violations if any sent from client (though usually they are streamed)
        if (Array.isArray(violations)) {
            // We might want to save these to ProctoringLog if not already done
            // For now, just count them towards trust score decrement
            const violationCount = violations.length;
            attempt.totalViolations = (attempt.totalViolations || 0) + violationCount;
            attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - (violationCount * 5));
        }
        await attempt.save();
        res.status(200).json({ message: 'Test submitted successfully', score: totalScore });
    }
    catch (error) {
        console.error('Submit test error:', error);
        res.status(500).json({ message: 'Failed to submit test', error: error?.message });
    }
});
// Run Code Endpoint (using Piston API)
app.post('/api/student/run-code', async (req, res) => {
    const { language, code, stdin, mode, testCases, questionId } = req.body;
    if (!language || !code) {
        return res.status(400).json({ message: 'Language and code are required.' });
    }
    // If questionId provided, fetch test cases from DB (secure execution)
    let dbTestCases = null;
    if (questionId && mongoose_1.default.isValidObjectId(questionId)) {
        const question = await Question_1.default.findById(questionId);
        if (question && question.type === 'coding') {
            dbTestCases = question.codingTestCases || [];
        }
    }
    const effectiveTestCases = dbTestCases || testCases;
    // Piston supported languages mapping
    // We can add more mappings here if needed (e.g., 'c++' -> 'cpp')
    const pistionLanguage = language === 'c++' ? 'cpp' : language;
    const executePiston = async (input) => {
        const pistonPayload = {
            language: pistionLanguage,
            version: '*',
            files: [{ content: code }],
            stdin: input || '',
        };
        const response = await fetch('https://emkc.org/api/v2/piston/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pistonPayload),
        });
        if (!response.ok)
            throw new Error(`Piston API Error: ${response.statusText}`);
        return await response.json();
    };
    try {
        if (mode === 'batch' && Array.isArray(effectiveTestCases)) {
            // Run against all test cases sequentially to avoid Piston API rate limits
            const results = [];
            for (let i = 0; i < effectiveTestCases.length; i++) {
                const testCase = effectiveTestCases[i];
                try {
                    // Add a small delay between requests if needed, but sequential should be enough for now
                    const data = await executePiston(testCase.input);
                    const output = data.run ? data.run.output.trim() : ''; // Trim for comparison
                    const expected = (testCase.output || '').trim();
                    const passed = output === expected;
                    results.push({
                        id: i,
                        input: testCase.hidden ? '[Hidden]' : testCase.input,
                        expectedOutput: testCase.hidden ? '[Hidden]' : expected,
                        actualOutput: testCase.hidden ? (passed ? '[Hidden]' : 'Hidden test case failed') : output,
                        passed: passed,
                        error: testCase.hidden ? null : (data.run && data.run.code !== 0 ? data.run.output : null),
                        hidden: !!testCase.hidden
                    });
                }
                catch (err) {
                    results.push({
                        id: i,
                        input: testCase.hidden ? '[Hidden]' : testCase.input,
                        expectedOutput: testCase.hidden ? '[Hidden]' : testCase.output,
                        actualOutput: '',
                        passed: false,
                        error: testCase.hidden ? 'Error executing hidden test case' : err.message,
                        hidden: !!testCase.hidden
                    });
                }
            }
            const passedCount = results.filter(r => r.passed).length;
            res.json({ mode: 'batch', results, passedCount, total: results.length });
        }
        else {
            // Default / Custom Input Mode (Single Run)
            const data = await executePiston(stdin);
            res.json({
                mode: 'custom',
                run: data.run
            });
        }
    }
    catch (error) {
        console.error('Code execution error:', error);
        res.status(500).json({ message: 'Failed to execute code.', error: error.message });
    }
});
// Endpoint to record multiple-monitor detection and block the attempt when necessary
app.post('/api/student/multi-monitor-detected', async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
        }
        let { studentId, testId } = req.body;
        if (!studentId) {
            const user = req.user;
            if (user && user.id)
                studentId = user.id;
        }
        if (!studentId || !testId) {
            return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
        }
        // Verify test exists
        const test = await Test_1.default.findById(testId);
        if (!test)
            return res.status(404).json({ message: 'Test not found', error: 'TEST_NOT_FOUND' });
        // Find or create an attempt and mark it blocked
        let attempt = await ExamAttempt_1.default.findOne({ testId, studentId });
        const now = new Date();
        if (!attempt) {
            attempt = new ExamAttempt_1.default({
                testId,
                studentId,
                status: 'blocked',
                totalScore: 0,
                trustScore: 0,
                totalViolations: 1,
            });
        }
        else {
            // Increment violations and set blocked status
            attempt.totalViolations = (attempt.totalViolations || 0) + 1;
            attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - 30);
            attempt.status = 'blocked';
        }
        await attempt.save();
        // Create a proctoring log for the examiner to review
        const log = new ProctoringLog_1.default({
            attemptId: attempt._id,
            timestamp: now,
            label: 'Multiple Monitors',
            severity: 'high',
        });
        await log.save();
        return res.status(403).json({ message: 'Multiple monitors detected — attempt blocked', error: 'MULTIPLE_MONITORS_DETECTED', attemptId: attempt._id.toString() });
    }
    catch (error) {
        console.error('Multi-monitor detection error:', error);
        return res.status(500).json({ message: 'Failed to record multi-monitor detection', error: error?.message });
    }
});
// Used by StudentTest.tsx to submit answers and save recording
app.post('/api/student/submit-test', async (req, res) => {
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
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
        const existingSubmission = await ExamAttempt_1.default.findOne({
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
        const duration = Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
        // Fetch test to evaluate answers against embedded questions
        const test = await Test_1.default.findById(testId);
        let actualScore = 0;
        let questionsAttempted = 0;
        const examAnswers = [];
        let evaluationQuestions = [];
        if (test?.questionIds?.length) {
            // Only fetch necessary fields for evaluation (optimization: select specific fields)
            const questionDocs = await Question_1.default.find({ _id: { $in: test.questionIds } }, { type: 1, correctAnswer: 1, marks: 1 }).lean(); // Use lean() for read-only data (faster queries)
            const questionMap = new Map(questionDocs.map((doc) => [doc._id.toString(), doc]));
            evaluationQuestions = test.questionIds
                .map((id, index) => {
                const doc = questionMap.get(id.toString());
                if (!doc)
                    return null;
                return {
                    index: index + 1,
                    questionId: id,
                    type: doc.type,
                    correctAnswer: doc.type === 'mcq' && typeof doc.correctAnswer === 'number'
                        ? doc.correctAnswer
                        : undefined,
                    marks: doc.marks || 1,
                };
            })
                .filter(Boolean);
        }
        for (const q of evaluationQuestions) {
            const givenAnswer = answers ? answers[q.index] : undefined;
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
        let attempt = await ExamAttempt_1.default.findOne({ testId, studentId });
        if (!attempt) {
            attempt = new ExamAttempt_1.default({
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
        }
        else {
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
                    const log = new ProctoringLog_1.default({
                        attemptId: attempt._id,
                        timestamp: violation.timestamp ? new Date(violation.timestamp) : new Date(),
                        label,
                        severity: violation.severity || 'medium',
                    });
                    await log.save();
                }
                console.log(`✓ Logged ${violations.length} violations for student ${studentId} on test ${testId}`);
            }
            catch (logError) {
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
    }
    catch (error) {
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
    (0, faceRecognition_1.loadFaceModels)().catch((error) => {
        console.error('⚠ Face recognition models not loaded:', error.message);
        console.error('⚠ Face verification will not work. Please download models from:');
        console.error('⚠ https://github.com/justadudewhohacks/face-api.js-models');
        console.error('⚠ Place them in: server/models/ directory');
    });
    // Connect to MongoDB if URI is provided
    if (MONGODB_URI) {
        try {
            await mongoose_1.default.connect(MONGODB_URI);
            console.log('✓ MongoDB connected successfully');
        }
        catch (err) {
            console.error('✗ MongoDB connection error:', err);
            console.error('⚠ Server will continue but authentication will fail. Please check your MONGODB_URI in .env file.');
        }
    }
    else {
        console.log('⚠ MongoDB URI not configured. Please set MONGODB_URI in your .env file.');
        console.log('⚠ Authentication features will not work without MongoDB connection.');
    }
    // Start the server
    app.listen(PORT, () => {
        console.log(`\nPariksha AI Backend server is running on port ${PORT}`);
        console.log(`CORS enabled for origin: ${CORS_ORIGIN || 'Not set (check CORS_ORIGIN in .env)'}`);
        if (MONGODB_URI) {
            console.log('✓ MongoDB URI configured');
        }
        else {
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
