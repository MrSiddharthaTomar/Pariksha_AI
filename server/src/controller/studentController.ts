import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import Test from '../models/Test';
import ProctoringLog from '../models/ProctoringLog';
import Question from '../models/Question';
import ExamAttempt from '../models/ExamAttempt';
import TestRecording from '../models/TestRecording';
import { processVideoChunkWithML, extractFrameFromVideo } from '../utils/mlProctoring';
import { getCheatingImagesBucket } from '../utils/gridfs';

export const getEnrolledTests = async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    let { studentId, email } = req.query as { studentId?: string; email?: string };

    // Prefer authenticated user identity to avoid stale client localStorage values.
    if (!studentId) {
      const user = (req as any).user;
      if (user?.id) studentId = user.id;
    }

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
};

export const getTestById = async (req: Request, res: Response) => {
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

    // Always prefer authenticated user identity to avoid stale/spoofed query params.
    const user = (req as any).user;
    if (user?.id) {
      studentId = user.id;
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

    let existingProgress = null;
    if (studentId) {
      const existingAttempt = await ExamAttempt.findOne({
        testId,
        studentId,
      });

      if (existingAttempt && existingAttempt.status === 'submitted') {
        return res.status(403).json({
          message: 'You have already submitted this test.',
          error: 'TEST_ALREADY_SUBMITTED',
        });
      }

      // If there's an in-progress attempt, include the progress data
      if (existingAttempt && existingAttempt.status === 'in-progress') {
        let timeRemaining = existingAttempt.timeRemaining;
        let showLogoutWarning = false;

        // Check if student logged out and logged back in
        if (existingAttempt.lastLogoutAt) {
          const now = new Date();
          const logoutDuration = Math.floor((now.getTime() - existingAttempt.lastLogoutAt.getTime()) / 1000); // in seconds

          // Subtract logout time from remaining time
          if (timeRemaining !== undefined && timeRemaining > logoutDuration) {
            timeRemaining = timeRemaining - logoutDuration;
          } else if (timeRemaining !== undefined) {
            timeRemaining = 0; // Time ran out during logout
          }

          // Clear the logout time since we're handling it now
          existingAttempt.lastLogoutAt = undefined;
          existingAttempt.sessionWarningsShown = (existingAttempt.sessionWarningsShown || 0) + 1;
          showLogoutWarning = true;
          await existingAttempt.save();
        }

        existingProgress = {
          currentQuestionIndex: existingAttempt.currentQuestionIndex || 0,
          timeRemaining,
          answers: existingAttempt.partialAnswers || {},
          showLogoutWarning,
        };
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
          codingTestCases: (doc.codingTestCases || []).map((tc: any) => ({
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
      id: (test._id as any).toString(),
      name: test.name,
      description: test.description,
      duration: test.duration,
      status: test.status,
      startTime: test.startTime,
      endTime: test.endTime,
      questions: orderedQuestions,
      ...(existingProgress && { progress: existingProgress }),
    });
  } catch (error: any) {
    console.error('Get test error:', error);
    res.status(500).json({
      message: 'Failed to fetch test. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
};

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

export const processProctorChunk = async (req: Request, res: Response) => {
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
};

export const startAttempt = async (req: Request, res: Response) => {
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
};

export const submitTest = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    const { studentId, testId, answers, startTime, endTime, violations } = req.body;

    if (!studentId || !testId || !answers) {
      return res.status(400).json({ message: 'Missing required submission fields', error: 'MISSING_FIELDS' });
    }

    // Try to find existing attempt first to avoid duplicates if possible, though schema handles unique
    let attempt = await ExamAttempt.findOne({ studentId, testId });
    if (!attempt) {
      // Should ideally exist if 'start-test' was called, but if not create one
      attempt = new ExamAttempt({
        studentId,
        testId,
        startedAt: startTime ? new Date(startTime) : new Date(),
        status: 'in-progress'
      });
    }

    // Process answers - calculate score for MCQs
    // We need to fetch the test questions to grade
    const test = await Test.findById(testId).populate('questionIds');
    if (!test) return res.status(404).json({ message: 'Test not found' });

    const questionsMap: Record<string, any> = {};
    const orderedQuestionIds: string[] = [];
    (test.questionIds as any[]).forEach((q: any) => {
      const qId = (q._id as any).toString();
      questionsMap[qId] = q;
      orderedQuestionIds.push(qId);
    });

    const normalizedAnswers: Record<string, any> = {};
    Object.entries(answers).forEach(([qKey, value]) => {
      let normalizedKey = qKey;
      if (!questionsMap[normalizedKey] && /^[0-9]+$/.test(qKey)) {
        const numericIndex = Number(qKey);
        const mappedId = orderedQuestionIds[numericIndex - 1];
        if (mappedId) normalizedKey = mappedId;
      }
      normalizedAnswers[normalizedKey] = value;
    });

    let totalScore = 0;
    const processedAnswers = Object.keys(normalizedAnswers).map((qId: string) => {
      const question = questionsMap[qId];
      if (!question) return null; // Should not happen

      const submittedAns = normalizedAnswers[qId];

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
      } else if (question.type === 'coding') {
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
    attempt.answers = processedAnswers as any;
    attempt.totalScore = totalScore;
    attempt.questionsAttempted = processedAnswers.length;
    if (attempt.startedAt && attempt.endedAt) {
      attempt.duration = Math.max(0, Math.round((attempt.endedAt.getTime() - attempt.startedAt.getTime()) / 60000));
    }

    // Process violations if any sent from client (though usually they are streamed)
    if (Array.isArray(violations) && violations.length > 0) {
      const existingLogCount = await ProctoringLog.countDocuments({ attemptId: attempt._id });
      if (existingLogCount === 0) {
        const violationDocs = violations.map((violation: any) => {
          const label = mapViolationTypeToLabel(violation.type || violation.label || 'Suspicious behavior detected');
          const severity = violation.severity || 'medium';
          return {
            attemptId: attempt._id,
            timestamp: violation.timestamp ? new Date(violation.timestamp) : new Date(),
            label,
            severity,
          };
        }).filter((doc: any) => !!doc.label);

        if (violationDocs.length > 0) {
          await ProctoringLog.insertMany(violationDocs);
          const penalty = violationDocs.reduce((acc: number, doc: any) => acc + (doc.severity === 'high' ? 10 : doc.severity === 'medium' ? 5 : 2), 0);
          attempt.totalViolations = Math.max(attempt.totalViolations || 0, violationDocs.length);
          attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - penalty);
        }
      } else {
        attempt.totalViolations = Math.max(attempt.totalViolations || 0, existingLogCount, violations.length);
      }
    } else {
      // No violations
    }

    await attempt.save();

    res.status(200).json({ message: 'Test submitted successfully', score: totalScore });

  } catch (error: any) {
    console.error('Submit test error:', error);
    res.status(500).json({ message: 'Failed to submit test', error: error?.message });
  }
};

export const saveProgress = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    const { studentId, testId, currentQuestionIndex, timeRemaining, answers } = req.body;

    if (!studentId || !testId) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
    }

    // Find or create the attempt
    let attempt = await ExamAttempt.findOne({ studentId, testId });
    if (!attempt) {
      // Create attempt if it doesn't exist
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startedAt: new Date(),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
        currentQuestionIndex: currentQuestionIndex || 0,
        timeRemaining,
        partialAnswers: answers || {},
      });
    }

    if (attempt.status === 'submitted') {
      return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
    }

    // Update progress fields
    if (currentQuestionIndex !== undefined) {
      attempt.currentQuestionIndex = currentQuestionIndex;
    }
    if (timeRemaining !== undefined) {
      attempt.timeRemaining = timeRemaining;
    }
    if (answers !== undefined) {
      attempt.partialAnswers = answers;
    }

    await attempt.save();

    res.status(200).json({ message: 'Progress saved successfully' });
  } catch (error: any) {
    console.error('Save progress error:', error);
    res.status(500).json({ message: 'Failed to save progress', error: error?.message });
  }
};

export const recordLogout = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId } = req.body;

    // If studentId not supplied, get it from JWT
    if (!studentId) {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    if (!studentId || !testId) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
    }

    // Find the attempt
    const attempt = await ExamAttempt.findOne({ studentId, testId });
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found', error: 'ATTEMPT_NOT_FOUND' });
    }

    if (attempt.status === 'submitted') {
      return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
    }

    // Record logout time
    attempt.lastLogoutAt = new Date();
    await attempt.save();

    res.status(200).json({ message: 'Logout recorded successfully' });
  } catch (error: any) {
    console.error('Record logout error:', error);
    res.status(500).json({ message: 'Failed to record logout', error: error?.message });
  }
};

export const reportMonitorRisk = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId, reason } = req.body as {
      studentId?: string;
      testId?: string;
      reason?: 'multiple_detected' | 'permission_denied';
    };

    if (!studentId) {
      const user = (req as any).user;
      if (user?.id) studentId = user.id;
    }

    if (!studentId || !testId || !reason) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId, reason', error: 'MISSING_FIELDS' });
    }

    let attempt = await ExamAttempt.findOne({ testId, studentId });
    if (!attempt) {
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startedAt: new Date(),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
      });
      await attempt.save();
    }

    // Deduplicate frequent identical logs from periodic polling.
    const dedupeWindowMs = 2 * 60 * 1000;
    const recent = await ProctoringLog.findOne({
      attemptId: attempt._id,
      label: 'Multiple Monitors',
      timestamp: { $gte: new Date(Date.now() - dedupeWindowMs) },
    }).sort({ timestamp: -1 });

    if (recent) {
      return res.status(200).json({ message: 'Monitor risk already logged recently', deduped: true });
    }

    const severity: 'medium' | 'high' = reason === 'multiple_detected' ? 'high' : 'medium';
    await ProctoringLog.create({
      attemptId: attempt._id,
      timestamp: new Date(),
      label: 'Multiple Monitors',
      severity,
    });

    const penalty = severity === 'high' ? 10 : 5;
    attempt.totalViolations += 1;
    attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - penalty);
    await attempt.save();

    res.status(200).json({ message: 'Monitor risk logged', severity });
  } catch (error: any) {
    console.error('Report monitor risk error:', error);
    // Keep this endpoint non-blocking for exam flow.
    res.status(200).json({ message: 'Monitor risk received (processing error logged)' });
  }
};