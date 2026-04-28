import { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import User from '../models/User';
import Test from '../models/Test';
import ProctoringLog from '../models/ProctoringLog';
import Question from '../models/Question';
import ExamAttempt from '../models/ExamAttempt';
import AttemptEventLog from '../models/AttemptEventLog';
import TestRecording from '../models/TestRecording';
import { processVideoChunkWithML, extractFrameFromVideo, processFrameImageWithML } from '../utils/mlProctoring';
import { getCheatingImagesBucket } from '../utils/gridfs';

const shuffleWithSeed = <T>(items: T[], seed: string): T[] => {
  const arr = [...items];
  let state = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) || 1;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

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
    let attemptForResponse: any = null;
    if (studentId) {
      let existingAttempt = await ExamAttempt.findOne({
        testId,
        studentId,
      });

      if (existingAttempt && existingAttempt.status === 'submitted') {
        return res.status(403).json({
          message: 'You have already submitted this test.',
          error: 'TEST_ALREADY_SUBMITTED',
        });
      }

      if (!existingAttempt) {
        existingAttempt = await ExamAttempt.create({
          testId,
          studentId,
          status: 'in-progress',
          startTime: new Date(),
          startedAt: new Date(),
          duration: Math.max(0, Math.round((test.duration || 60) * 60)),
          totalScore: 0,
          trustScore: 100,
          totalViolations: 0,
          questionsAttempted: 0,
          answers: [],
          partialAnswers: {},
          exitCount: 0,
          isSubmitted: false,
          lastHeartbeatAt: new Date(),
          lastActivityAt: new Date(),
        });
      }

      await enforceAttemptState(existingAttempt, now);
      if (existingAttempt.status === 'submitted' || existingAttempt.isSubmitted) {
        return res.status(403).json({
          message: 'This attempt has already been submitted.',
          error: existingAttempt.submissionReason === 'timer_expired' ? 'TEST_AUTO_SUBMITTED_TIME_EXPIRED' : 'TEST_ALREADY_SUBMITTED',
        });
      }

      attemptForResponse = existingAttempt;

      // If there's an in-progress attempt, include the progress data
      if (existingAttempt.status === 'in-progress') {
        const timeRemaining = getRemainingTimeSeconds(existingAttempt, now);
        const remainingExitAttempts = Math.max(0, MAX_ALLOWED_EXITS - (existingAttempt.exitCount || 0));

        existingProgress = {
          currentQuestionIndex: existingAttempt.currentQuestionIndex || 0,
          timeRemaining,
          answers: existingAttempt.partialAnswers || {},
          exitCount: existingAttempt.exitCount || 0,
          allowedExits: MAX_ALLOWED_EXITS,
          remainingExitAttempts,
          showExitWarning: (existingAttempt.exitCount || 0) > 0,
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

    // Build stable per-attempt randomization (question order + MCQ option order)
    const baseQuestionIdStrings = questionIds.map((id: any) => (id as any).toString());
    let randomizedQuestionIds = [...baseQuestionIdStrings];
    let optionOrderByQuestion: Record<string, number[]> = {};

    if (attemptForResponse) {
      if (!Array.isArray(attemptForResponse.questionOrder) || attemptForResponse.questionOrder.length !== baseQuestionIdStrings.length) {
        const seed = ((attemptForResponse._id as any).toString() || crypto.randomUUID()) + ':questions';
        randomizedQuestionIds = shuffleWithSeed(baseQuestionIdStrings, seed);
        attemptForResponse.questionOrder = randomizedQuestionIds;
      } else {
        randomizedQuestionIds = attemptForResponse.questionOrder;
      }

      optionOrderByQuestion = attemptForResponse.optionOrderByQuestion || {};
      for (const qId of randomizedQuestionIds) {
        const qDoc: any = questionMap.get(qId);
        if (!qDoc || qDoc.type !== 'mcq') continue;
        const optionCount = Array.isArray(qDoc.options) ? qDoc.options.length : 0;
        if (optionCount < 2) continue;
        const existingOrder = optionOrderByQuestion[qId];
        if (!Array.isArray(existingOrder) || existingOrder.length !== optionCount) {
          const originalIndices = Array.from({ length: optionCount }, (_, i) => i);
          optionOrderByQuestion[qId] = shuffleWithSeed(originalIndices, `${(attemptForResponse._id as any).toString()}:${qId}`);
        }
      }
      attemptForResponse.optionOrderByQuestion = optionOrderByQuestion;
      await attemptForResponse.save();
    }

    const orderedQuestions = randomizedQuestionIds
      .map((id, index) => {
        const doc = questionMap.get((id as any).toString());
        if (!doc) return null;
        const qId = (doc._id as any).toString();
        const randomizedOptionOrder = optionOrderByQuestion[qId];
        let options = doc.type === 'mcq' ? (doc.options || []) : [];
        if (doc.type === 'mcq' && Array.isArray(randomizedOptionOrder) && randomizedOptionOrder.length === options.length) {
          options = randomizedOptionOrder.map((originalIdx) => options[originalIdx]);
        }
        return {
          id: index + 1,
          questionId: qId,
          type: doc.type,
          question: doc.questionText,
          options,
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
      attemptId: attemptForResponse ? (attemptForResponse._id as any).toString() : undefined,
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

const DEFAULT_MIN_CONFIDENCE = Number(process.env.PROCTORING_MIN_VIOLATION_CONFIDENCE || 0.55);
const MIN_CONFIDENCE_BY_LABEL: Record<string, number> = {
  'Phone Detected': Number(process.env.PROCTORING_MIN_CONF_PHONE || 0.56),
  'Multiple Faces': Number(process.env.PROCTORING_MIN_CONF_MULTIPLE || 0.58),
  'No Person Visible': Number(process.env.PROCTORING_MIN_CONF_NO_PERSON || 0.5),
  'Audio Detected': Number(process.env.PROCTORING_MIN_CONF_AUDIO || 0.65),
  'Looking Away': Number(process.env.PROCTORING_MIN_CONF_LOOKING_AWAY || 0.52),
};
const VIOLATION_DEDUPE_WINDOW_MS = Number(process.env.PROCTORING_DEDUPE_WINDOW_MS || 15000);
const LOOKING_AWAY_WINDOW_MS = Number(process.env.PROCTORING_LOOKING_AWAY_WINDOW_MS || 45000);
const LOOKING_AWAY_MIN_EVENTS = Number(process.env.PROCTORING_LOOKING_AWAY_MIN_EVENTS || 3);
const NO_PERSON_STARTUP_GRACE_MS = Number(process.env.PROCTORING_NO_PERSON_STARTUP_GRACE_MS || 20000);
const HEARTBEAT_TIMEOUT_MS = Number(process.env.ATTEMPT_HEARTBEAT_TIMEOUT_MS || 25000);
const EXIT_INCREMENT_DEDUPE_MS = Number(process.env.ATTEMPT_EXIT_INCREMENT_DEDUPE_MS || 8000);
const MAX_ALLOWED_EXITS = Number(process.env.ATTEMPT_MAX_ALLOWED_EXITS || 2);

type SubmitReason = 'manual' | 'timer_expired' | 'exit_limit' | 'heartbeat_timeout';

function getRequiredConfidence(label: string): number {
  return MIN_CONFIDENCE_BY_LABEL[label] ?? DEFAULT_MIN_CONFIDENCE;
}

function getAttemptStartTime(attempt: any): Date | undefined {
  return attempt.startTime || attempt.startedAt || attempt.createdAt;
}

function getRemainingTimeSeconds(attempt: any, now = new Date()): number {
  const attemptStartTime = getAttemptStartTime(attempt);
  if (!attemptStartTime || typeof attempt.duration !== 'number') return 0;

  const elapsedSeconds = Math.floor((now.getTime() - new Date(attemptStartTime).getTime()) / 1000);
  return Math.max(0, attempt.duration - elapsedSeconds);
}

function hasTimerExpired(attempt: any, now = new Date()): boolean {
  return getRemainingTimeSeconds(attempt, now) <= 0;
}

function shouldIncrementExitCount(attempt: any, at: Date) {
  const lastHeartbeatAt = attempt.lastHeartbeatAt ? new Date(attempt.lastHeartbeatAt).getTime() : 0;
  const lastExitAt = attempt.lastExitAt ? new Date(attempt.lastExitAt).getTime() : 0;
  const lastExitIncrementAt = attempt.lastExitIncrementAt ? new Date(attempt.lastExitIncrementAt).getTime() : 0;

  if (lastHeartbeatAt && lastExitAt >= lastHeartbeatAt) {
    return false;
  }

  if (lastExitIncrementAt && at.getTime() - lastExitIncrementAt < EXIT_INCREMENT_DEDUPE_MS) {
    return false;
  }

  return true;
}

function isWithinAttemptStartupGrace(attempt: any, eventTime: Date): boolean {
  const startedAtRaw = attempt?.startedAt || attempt?.createdAt;
  if (!startedAtRaw) return false;

  const startedAt = new Date(startedAtRaw);
  if (Number.isNaN(startedAt.getTime())) return false;

  return eventTime.getTime() - startedAt.getTime() < NO_PERSON_STARTUP_GRACE_MS;
}

async function saveEvidenceImageFromDataUrl(
  frameImage: string | undefined,
  metadata: Record<string, any>
): Promise<mongoose.Types.ObjectId | undefined> {
  if (!frameImage || !frameImage.startsWith('data:image/')) return undefined;
  const bucket = getCheatingImagesBucket();
  const base64Data = frameImage.includes(',')
    ? frameImage.split(',')[1]
    : frameImage.replace(/^data:image\/\w+;base64,/, '');
  const imageBuffer = Buffer.from(base64Data, 'base64');
  let imageId: mongoose.Types.ObjectId | undefined;

  await new Promise<void>((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(`violation_${Date.now()}.jpg`, { metadata });
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => {
      imageId = uploadStream.id as mongoose.Types.ObjectId;
      resolve();
    });
    uploadStream.end(imageBuffer);
  });

  return imageId;
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

    let { studentId, testId, videoChunk, frameImage, timestamp } = req.body as any;

    // If studentId not provided, pull from authenticated user (JWT)
    if (!studentId || studentId === 'unknown') {
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

    const hasClientFrameEvidence =
      typeof frameImage === 'string' && frameImage.startsWith('data:image/');

    // Extract frame from video as fallback when client frame is unavailable.
    const extractedFrameImage = hasClientFrameEvidence
      ? ''
      : await extractFrameFromVideo(videoBuffer);
    const evidenceFrameImage = hasClientFrameEvidence ? frameImage : extractedFrameImage;

    // Process video chunk with ML model
    let detectionSource: 'video_chunk' | 'image_fallback' = 'video_chunk';
    let mlResult = await processVideoChunkWithML(videoBuffer);
    const hasEvidenceFrame = typeof evidenceFrameImage === 'string' && evidenceFrameImage.startsWith('data:image/');

    // Always evaluate the frame when available and prefer whichever result has stronger confidence/severity.
    if (hasEvidenceFrame) {
      const imageMlResult = await processFrameImageWithML(evidenceFrameImage);
      const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
      const videoScore =
        (severityRank[(mlResult.severity || 'low') as string] || 0) * 10 + (mlResult.confidence || 0);
      const imageScore =
        (severityRank[(imageMlResult.severity || 'low') as string] || 0) * 10 + (imageMlResult.confidence || 0);

      const videoHasDecodeError =
        typeof mlResult.details === 'string' &&
        /(decode failed|invalid video dimensions|could not extract frames|unable to open video)/i.test(mlResult.details);

      if (
        imageMlResult.hasViolation &&
        (!mlResult.hasViolation || videoHasDecodeError || imageScore >= videoScore)
      ) {
        mlResult = imageMlResult;
        detectionSource = 'image_fallback';
      }
    } else {
      console.log('[PROCTOR] No client/server frame available for image fallback');
    }

    const logTimestamp = timestamp ? new Date(timestamp) : new Date();

    // Ensure an exam attempt exists for this student & test so we can attach live frames
    let attempt = await ExamAttempt.findOne({ testId, studentId });
    if (!attempt) {
      const test = await Test.findById(testId);
      // If the student hasn't explicitly started attempt yet, create one in-progress
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startTime: timestamp ? new Date(timestamp) : new Date(),
        startedAt: timestamp ? new Date(timestamp) : new Date(),
        duration: Math.max(0, Math.round(((test?.duration || 60)) * 60)),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
        partialAnswers: {},
        exitCount: 0,
        isSubmitted: false,
        lastHeartbeatAt: logTimestamp,
        lastActivityAt: logTimestamp,
      });
      await attempt.save();
      console.log(`[PROCTOR] Created new exam attempt for student ${studentId}`);
    }

    // If we extracted a frame, attach it to the attempt for live monitoring (keeps latest snapshot)
    try {
      if (evidenceFrameImage) {
        // Use .set to avoid TypeScript property mismatch on Mongoose document type
        attempt.set({ latestFrame: evidenceFrameImage, latestFrameAt: logTimestamp });
        await attempt.save();
      }
    } catch (frameError) {
      console.error('[PROCTOR] Error saving latest frame on attempt:', frameError);
    }

    // If violation detected, persist only when confidence is strong AND image evidence is available.
    if (mlResult.hasViolation && mlResult.violationType) {
      const label = mapViolationTypeToLabel(mlResult.violationType);
      const severity = mlResult.severity || 'medium';
      const confidence = typeof mlResult.confidence === 'number' ? mlResult.confidence : 0;
      const requiredConfidence = getRequiredConfidence(label);
      const hasFrameEvidence =
        typeof evidenceFrameImage === 'string' && evidenceFrameImage.startsWith('data:image/');

      if (confidence < requiredConfidence) {
        console.log(
          `[PROCTOR] Discarded violation (low confidence): ${label} confidence=${confidence.toFixed(
            3
          )} required=${requiredConfidence}`
        );
        return res.status(200).json({
          message: 'Chunk processed successfully',
          violationDetected: false,
        });
      }

      if (!hasFrameEvidence) {
        console.log(`[PROCTOR] Discarded violation (no image evidence): ${label}`);
        return res.status(200).json({
          message: 'Chunk processed successfully',
          violationDetected: false,
        });
      }

      // Camera warm-up can produce black frames and false "No Person Visible" detections.
      if (label === 'No Person Visible' && isWithinAttemptStartupGrace(attempt, logTimestamp)) {
        console.log(`[PROCTOR] Discarded violation (camera startup grace): ${label}`);
        return res.status(200).json({
          message: 'Chunk processed successfully',
          violationDetected: false,
        });
      }

      // Deduplicate frequent repeated events to reduce noisy false positives.
      const recentSimilar = await ProctoringLog.findOne({
        attemptId: attempt._id,
        label,
        timestamp: { $gte: new Date(logTimestamp.getTime() - VIOLATION_DEDUPE_WINDOW_MS) },
      }).sort({ timestamp: -1 });

      if (recentSimilar) {
        console.log(`[PROCTOR] Deduped repeated violation: ${label}`);
        return res.status(200).json({
          message: 'Chunk processed successfully',
          violationDetected: false,
        });
      }

      console.log(
        `[PROCTOR] Violation accepted: ${mlResult.violationType} (${severity}) confidence=${confidence.toFixed(
          3
        )} source=${detectionSource}`
      );

      // Save frame as GridFS file if available
      let imageId: mongoose.Types.ObjectId | undefined;
      try {
        if (hasFrameEvidence) {
          imageId = await saveEvidenceImageFromDataUrl(evidenceFrameImage, {
            attemptId: attempt!._id,
            timestamp: logTimestamp,
            label: mlResult.violationType,
            severity: mlResult.severity || 'medium',
          });
          console.log(`[PROCTOR] Saved violation image to GridFS`);
        }
      } catch (gridfsError) {
        console.error('[PROCTOR] Error saving proctoring image to GridFS:', gridfsError);
      }

      // Hard requirement: violations without persisted image evidence are invalid.
      if (!imageId) {
        console.log(`[PROCTOR] Discarded violation (image upload missing): ${label}`);
        return res.status(200).json({
          message: 'Chunk processed successfully',
          violationDetected: false,
        });
      }

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
        confidence,
        detectionSource,
      });
    } else {
      console.log(
        `[PROCTOR] No violation in chunk from student ${studentId} (latest frame saved) source=${detectionSource}`
      );
      res.status(200).json({
        message: 'Chunk processed successfully',
        violationDetected: false,
        detectionSource,
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
    if (!studentId || studentId === 'unknown') {
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
        startTime: now,
        startedAt: now,
        duration: Math.max(0, Math.round((test.duration || 60) * 60)),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
        partialAnswers: {},
        exitCount: 0,
        isSubmitted: false,
        lastHeartbeatAt: now,
        lastActivityAt: now,
      });
    } else {
      // Ensure it's marked in-progress
      attempt.status = 'in-progress';
      if (!attempt.startTime) attempt.startTime = attempt.startedAt || now;
      if (!attempt.startedAt) attempt.startedAt = attempt.startTime || now;
      if (typeof attempt.duration !== 'number') {
        attempt.duration = Math.max(0, Math.round((test.duration || 60) * 60));
      }
      attempt.timeRemaining = getRemainingTimeSeconds(attempt, now);
      attempt.lastHeartbeatAt = now;
      attempt.lastActivityAt = now;
    }

    await attempt.save();

    res.status(200).json({
      message: 'Attempt started',
      attemptId: (attempt._id as any).toString(),
      status: attempt.status,
      remainingTime: getRemainingTimeSeconds(attempt, now),
      exitCount: attempt.exitCount || 0,
      allowedExits: MAX_ALLOWED_EXITS,
    });
  } catch (error: any) {
    console.error('Start attempt error:', error);
    res.status(500).json({ message: 'Failed to start attempt', error: error?.message });
  }
};

async function processAttemptAnswers(
  attempt: any,
  testId: string,
  answers: any,
  endTime: Date | string | undefined,
  submitReason: SubmitReason = 'manual'
) {
  const test = await Test.findById(testId).populate('questionIds');
  if (!test) throw new Error('Test not found');

  const questionsMap: Record<string, any> = {};
  const orderedQuestionIds: string[] = [];
  (test.questionIds as any[]).forEach((q: any) => {
    const qId = (q._id as any).toString();
    questionsMap[qId] = q;
    orderedQuestionIds.push(qId);
  });

  const normalizedAnswers: Record<string, any> = {};
  Object.entries(answers || {}).forEach(([qKey, value]) => {
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
    if (!question) return null;

    const submittedAns = normalizedAnswers[qId];
    let isCorrect = false;
    let marksObtained = 0;

    if (question.type === 'mcq') {
      const optionOrder = (attempt.optionOrderByQuestion || {})[qId];
      let normalizedSubmitted = Number(submittedAns);
      if (Array.isArray(optionOrder) && optionOrder.length > normalizedSubmitted && normalizedSubmitted >= 0) {
        normalizedSubmitted = Number(optionOrder[normalizedSubmitted]);
      }
      if (normalizedSubmitted === Number(question.correctAnswer)) {
        isCorrect = true;
        marksObtained = question.marks || 1;
      }
    } else if (question.type === 'coding') {
      isCorrect = false;
      marksObtained = 0;
    }

    totalScore += marksObtained;

    return {
      questionId: question._id,
      answer: submittedAns,
      isCorrect,
      marksObtained
    };
  }).filter(Boolean);

  attempt.status = 'submitted';
  attempt.isSubmitted = true;
  attempt.endedAt = endTime ? new Date(endTime) : new Date();
  attempt.answers = processedAnswers as any;
  attempt.partialAnswers = normalizedAnswers;
  attempt.totalScore = totalScore;
  attempt.questionsAttempted = processedAnswers.length;
  attempt.timeRemaining = 0;
  attempt.submissionReason = submitReason;
  attempt.lastActivityAt = attempt.endedAt;
  
  return totalScore;
}

async function autoSubmitAttemptIfNeeded(
  attempt: any,
  reason: Exclude<SubmitReason, 'manual'>,
  eventAt = new Date()
) {
  if (!attempt || attempt.status === 'submitted' || attempt.isSubmitted) {
    return { submitted: false, reason: null as SubmitReason | null };
  }

  try {
    await processAttemptAnswers(
      attempt,
      (attempt.testId as any).toString(),
      attempt.partialAnswers || {},
      eventAt,
      reason
    );
  } catch (error) {
    console.error(`Failed to auto-submit attempt (${reason}):`, error);
    attempt.status = 'submitted';
    attempt.isSubmitted = true;
    attempt.endedAt = eventAt;
    attempt.timeRemaining = 0;
    attempt.submissionReason = reason;
  }

  await AttemptEventLog.create({
    attemptId: attempt._id,
    studentId: attempt.studentId,
    testId: attempt.testId,
    eventType: 'auto_submitted',
    timestamp: eventAt,
    meta: { reason },
  });

  await attempt.save();
  return { submitted: true, reason };
}

async function markAttemptExit(
  attempt: any,
  source: 'pagehide' | 'visibilitychange' | 'heartbeat_timeout' | 'navigation' | 'legacy_logout',
  eventAt = new Date()
) {
  if (!attempt || attempt.status === 'submitted' || attempt.isSubmitted) {
    return { incremented: false, autoSubmitted: false, exitCount: attempt?.exitCount || 0 };
  }

  attempt.lastActivityAt = eventAt;

  if (!shouldIncrementExitCount(attempt, eventAt)) {
    await attempt.save();
    return { incremented: false, autoSubmitted: false, exitCount: attempt.exitCount || 0 };
  }

  attempt.exitCount = (attempt.exitCount || 0) + 1;
  attempt.lastExitAt = eventAt;
  attempt.lastExitIncrementAt = eventAt;

  await AttemptEventLog.create({
    attemptId: attempt._id,
    studentId: attempt.studentId,
    testId: attempt.testId,
    eventType: 'session_exit',
    timestamp: eventAt,
    meta: { source, exitCount: attempt.exitCount },
  });

  if ((attempt.exitCount || 0) > MAX_ALLOWED_EXITS) {
    const result = await autoSubmitAttemptIfNeeded(attempt, source === 'heartbeat_timeout' ? 'heartbeat_timeout' : 'exit_limit', eventAt);
    return { incremented: true, autoSubmitted: result.submitted, exitCount: attempt.exitCount || 0 };
  }

  await attempt.save();
  return { incremented: true, autoSubmitted: false, exitCount: attempt.exitCount || 0 };
}

async function enforceAttemptState(attempt: any, now = new Date()) {
  if (!attempt || attempt.status === 'submitted' || attempt.isSubmitted) {
    return { autoSubmitted: false, reason: null as SubmitReason | null };
  }

  if (hasTimerExpired(attempt, now)) {
    const result = await autoSubmitAttemptIfNeeded(attempt, 'timer_expired', now);
    return { autoSubmitted: result.submitted, reason: result.reason };
  }

  if (attempt.lastHeartbeatAt) {
    const heartbeatAgeMs = now.getTime() - new Date(attempt.lastHeartbeatAt).getTime();
    if (heartbeatAgeMs > HEARTBEAT_TIMEOUT_MS) {
      const result = await markAttemptExit(attempt, 'heartbeat_timeout', now);
      return { autoSubmitted: result.autoSubmitted, reason: result.autoSubmitted ? 'heartbeat_timeout' : null };
    }
  }

  attempt.timeRemaining = getRemainingTimeSeconds(attempt, now);
  await attempt.save();
  return { autoSubmitted: false, reason: null };
}

export async function runAttemptLifecycleSweep() {
  const attempts = await ExamAttempt.find({ status: 'in-progress' });
  const now = new Date();
  for (const attempt of attempts) {
    await enforceAttemptState(attempt, now);
  }
}

export const submitTest = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId, answers, startTime, endTime, violations, submitReason } = req.body;

    if (!studentId || studentId === 'unknown') {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    if (!studentId || !testId || !answers) {
      return res.status(400).json({ message: 'Missing required submission fields', error: 'MISSING_FIELDS' });
    }

    // Try to find existing attempt first to avoid duplicates if possible, though schema handles unique
    let attempt = await ExamAttempt.findOne({ studentId, testId });
    if (!attempt) {
      const test = await Test.findById(testId);
      // Should ideally exist if 'start-test' was called, but if not create one
      attempt = new ExamAttempt({
        studentId,
        testId,
        startTime: startTime ? new Date(startTime) : new Date(),
        startedAt: startTime ? new Date(startTime) : new Date(),
        duration: Math.max(0, Math.round(((test?.duration || 60)) * 60)),
        status: 'in-progress',
        partialAnswers: answers || {},
        lastHeartbeatAt: new Date(),
        lastActivityAt: new Date(),
      });
    }

    await enforceAttemptState(attempt, new Date());
    if (attempt.status === 'submitted' || attempt.isSubmitted) {
      return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
    }

    attempt.partialAnswers = answers || attempt.partialAnswers || {};
    attempt.lastActivityAt = new Date();
    const totalScore = await processAttemptAnswers(
      attempt,
      testId,
      answers,
      endTime,
      submitReason === 'timer_expired' ? 'timer_expired' : 'manual'
    );

    // Process violations if any sent from client (though usually they are streamed)
    if (Array.isArray(violations) && violations.length > 0) {
      const existingLogCount = await ProctoringLog.countDocuments({ attemptId: attempt._id });
      if (existingLogCount === 0) {
        const latestFrame = (attempt as any).latestFrame as string | undefined;
        const violationDocsWithEvidence = await Promise.all(
          violations.map(async (violation: any) => {
            const label = mapViolationTypeToLabel(violation.type || violation.label || 'Suspicious behavior detected');
            const severity = violation.severity || 'medium';
            const timestamp = violation.timestamp ? new Date(violation.timestamp) : new Date();

            if (label === 'No Person Visible' && isWithinAttemptStartupGrace(attempt, timestamp)) {
              return null;
            }

            let imageId: mongoose.Types.ObjectId | undefined;
            try {
              imageId = await saveEvidenceImageFromDataUrl(latestFrame, {
                attemptId: attempt!._id,
                timestamp,
                label,
                severity,
                source: 'submit-test-fallback',
              });
            } catch (error) {
              console.error('[PROCTOR] Unable to persist submit-time violation image:', error);
            }

            if (!imageId) return null;
            return {
              attemptId: attempt!._id,
              timestamp,
              label,
              severity,
              imageId,
            };
          })
        );
        const violationDocs = violationDocsWithEvidence.filter((doc: any) => !!doc?.label && !!doc?.imageId);

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

    let { studentId, testId, currentQuestionIndex, answers } = req.body;

    if (!studentId || studentId === 'unknown') {
      const user = (req as any).user;
      if (user && user.id) studentId = user.id;
    }

    if (!studentId || !testId) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
    }

    // Find or create the attempt
    let attempt = await ExamAttempt.findOne({ studentId, testId });
    if (!attempt) {
      const test = await Test.findById(testId);
      // Create attempt if it doesn't exist
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startTime: new Date(),
        startedAt: new Date(),
        duration: Math.max(0, Math.round(((test?.duration || 60)) * 60)),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
        exitCount: 0,
        isSubmitted: false,
        currentQuestionIndex: currentQuestionIndex || 0,
        partialAnswers: answers || {},
        lastHeartbeatAt: new Date(),
        lastActivityAt: new Date(),
      });
    }

    await enforceAttemptState(attempt, new Date());
    if (attempt.status === 'submitted' || attempt.isSubmitted) {
      return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
    }

    // Update progress fields
    if (currentQuestionIndex !== undefined) {
      attempt.currentQuestionIndex = currentQuestionIndex;
    }
    if (answers !== undefined) {
      attempt.partialAnswers = answers;
    }
    attempt.timeRemaining = getRemainingTimeSeconds(attempt, new Date());
    attempt.lastActivityAt = new Date();

    await attempt.save();

    res.status(200).json({
      message: 'Progress saved successfully',
      remainingTime: attempt.timeRemaining,
      exitCount: attempt.exitCount || 0,
      allowedExits: MAX_ALLOWED_EXITS,
    });
  } catch (error: any) {
    console.error('Save progress error:', error);
    res.status(500).json({ message: 'Failed to save progress', error: error?.message });
  }
};

export const recordExit = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId, source } = req.body as {
      studentId?: string;
      testId?: string;
      source?: 'pagehide' | 'visibilitychange' | 'navigation' | 'legacy_logout';
    };

    // If studentId not supplied, get it from JWT
    if (!studentId || studentId === 'unknown') {
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

    if (attempt.status === 'submitted' || attempt.isSubmitted) {
      return res.status(409).json({ message: 'Test already submitted', error: 'TEST_ALREADY_SUBMITTED' });
    }

    const result = await markAttemptExit(attempt, source || 'legacy_logout', new Date());
    res.status(200).json({
      message: result.autoSubmitted ? 'Test auto-submitted due to exit limit' : 'Exit recorded successfully',
      exitCount: result.exitCount,
      allowedExits: MAX_ALLOWED_EXITS,
      autoSubmitted: result.autoSubmitted,
    });
  } catch (error: any) {
    console.error('Record exit error:', error);
    res.status(500).json({ message: 'Failed to record exit', error: error?.message });
  }
};

export const recordHeartbeat = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId, attemptId, currentQuestionIndex, visibilityState } = req.body as {
      studentId?: string;
      testId?: string;
      attemptId?: string;
      currentQuestionIndex?: number;
      visibilityState?: string;
    };

    if (!studentId || studentId === 'unknown') {
      const user = (req as any).user;
      if (user?.id) studentId = user.id;
    }

    if (!studentId || !testId) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId', error: 'MISSING_FIELDS' });
    }

    let attempt = attemptId ? await ExamAttempt.findById(attemptId) : null;
    if (!attempt) {
      attempt = await ExamAttempt.findOne({ studentId, testId });
    }
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found', error: 'ATTEMPT_NOT_FOUND' });
    }

    await enforceAttemptState(attempt, new Date());
    if (attempt.status === 'submitted' || attempt.isSubmitted) {
      return res.status(409).json({
        message: 'Test already submitted',
        error: 'TEST_ALREADY_SUBMITTED',
        autoSubmitted: true,
        remainingTime: 0,
      });
    }

    const now = new Date();
    attempt.lastHeartbeatAt = now;
    attempt.lastActivityAt = now;
    attempt.timeRemaining = getRemainingTimeSeconds(attempt, now);
    if (currentQuestionIndex !== undefined) {
      attempt.currentQuestionIndex = currentQuestionIndex;
    }
    await attempt.save();

    await AttemptEventLog.create({
      attemptId: attempt._id,
      studentId: attempt.studentId,
      testId: attempt.testId,
      eventType: 'heartbeat',
      timestamp: now,
      questionIndex: currentQuestionIndex,
      meta: { visibilityState: visibilityState || 'unknown' },
    });

    res.status(200).json({
      message: 'Heartbeat recorded',
      remainingTime: attempt.timeRemaining,
      exitCount: attempt.exitCount || 0,
      allowedExits: MAX_ALLOWED_EXITS,
      autoSubmitted: false,
    });
  } catch (error: any) {
    console.error('Record heartbeat error:', error);
    res.status(500).json({ message: 'Failed to record heartbeat', error: error?.message });
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

    if (!studentId || studentId === 'unknown') {
      const user = (req as any).user;
      if (user?.id) studentId = user.id;
    }

    if (!studentId || !testId || !reason) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId, reason', error: 'MISSING_FIELDS' });
    }

    let attempt = await ExamAttempt.findOne({ testId, studentId });
    if (!attempt) {
      const test = await Test.findById(testId);
      attempt = new ExamAttempt({
        testId,
        studentId,
        status: 'in-progress',
        startTime: new Date(),
        startedAt: new Date(),
        duration: Math.max(0, Math.round(((test?.duration || 60)) * 60)),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
        partialAnswers: {},
        exitCount: 0,
        isSubmitted: false,
        lastHeartbeatAt: new Date(),
        lastActivityAt: new Date(),
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
    const latestFrame = (attempt as any).latestFrame as string | undefined;
    let imageId: mongoose.Types.ObjectId | undefined;
    try {
      imageId = await saveEvidenceImageFromDataUrl(latestFrame, {
        attemptId: attempt._id,
        timestamp: new Date(),
        label: 'Multiple Monitors',
        severity,
      });
    } catch (error) {
      console.error('[PROCTOR] Unable to persist monitor-risk evidence image:', error);
    }

    // Hard requirement: never log violations without image evidence.
    if (!imageId) {
      return res.status(200).json({ message: 'Monitor risk received but skipped (no image evidence)' });
    }

    await ProctoringLog.create({
      attemptId: attempt._id,
      timestamp: new Date(),
      label: 'Multiple Monitors',
      severity,
      imageId,
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

export const logActivityEvents = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available', error: 'DATABASE_UNAVAILABLE' });
    }

    let { studentId, testId, attemptId, events } = req.body as {
      studentId?: string;
      testId?: string;
      attemptId?: string;
      events?: Array<{
        eventType: 'tab_hidden' | 'tab_visible' | 'window_blur' | 'window_focus' | 'fullscreen_enter' | 'fullscreen_exit' | 'question_time_spent' | 'warning_shown';
        timestamp?: string;
        questionId?: string;
        questionIndex?: number;
        durationMs?: number;
        meta?: Record<string, any>;
      }>;
    };

    if (!studentId || studentId === 'unknown') {
      const user = (req as any).user;
      if (user?.id) studentId = user.id;
    }

    if (!studentId || !testId || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: 'Missing required fields: studentId, testId, events[]', error: 'MISSING_FIELDS' });
    }

    let attempt = attemptId ? await ExamAttempt.findById(attemptId) : null;
    if (!attempt) {
      attempt = await ExamAttempt.findOne({ studentId, testId });
    }
    if (!attempt) {
      const test = await Test.findById(testId);
      attempt = await ExamAttempt.create({
        testId,
        studentId,
        status: 'in-progress',
        startTime: new Date(),
        startedAt: new Date(),
        duration: Math.max(0, Math.round(((test?.duration || 60)) * 60)),
        totalScore: 0,
        trustScore: 100,
        totalViolations: 0,
        questionsAttempted: 0,
        answers: [],
        partialAnswers: {},
        exitCount: 0,
        isSubmitted: false,
        lastHeartbeatAt: new Date(),
        lastActivityAt: new Date(),
      });
    }

    const docs = events.slice(0, 200).map((evt) => ({
      attemptId: attempt!._id,
      studentId,
      testId,
      eventType: evt.eventType,
      timestamp: evt.timestamp ? new Date(evt.timestamp) : new Date(),
      questionId: evt.questionId,
      questionIndex: evt.questionIndex,
      durationMs: evt.durationMs,
      meta: evt.meta || {},
    }));

    await AttemptEventLog.insertMany(docs, { ordered: false });

    // Escalate repeated focus-loss patterns into a "Looking Away" proctoring log.
    const lookingAwayEventTypes = ['tab_hidden', 'window_blur', 'fullscreen_exit'];
    const lookingAwayCount = events.filter((evt) => lookingAwayEventTypes.includes(evt.eventType)).length;
    if (lookingAwayCount > 0) {
      const windowStart = new Date(Date.now() - LOOKING_AWAY_WINDOW_MS);
      const recentActivityCount = await AttemptEventLog.countDocuments({
        attemptId: attempt._id,
        eventType: { $in: lookingAwayEventTypes },
        timestamp: { $gte: windowStart },
      });

      if (recentActivityCount >= LOOKING_AWAY_MIN_EVENTS) {
        const recentLookingAwayLog = await ProctoringLog.findOne({
          attemptId: attempt._id,
          label: 'Looking Away',
          timestamp: { $gte: new Date(Date.now() - VIOLATION_DEDUPE_WINDOW_MS) },
        }).sort({ timestamp: -1 });

        if (!recentLookingAwayLog) {
          const confidence = Math.min(1, recentActivityCount / (LOOKING_AWAY_MIN_EVENTS + 2));
          const requiredConfidence = getRequiredConfidence('Looking Away');
          if (confidence >= requiredConfidence) {
            const latestFrame = (attempt as any).latestFrame as string | undefined;
            let imageId: mongoose.Types.ObjectId | undefined;
            try {
              imageId = await saveEvidenceImageFromDataUrl(latestFrame, {
                attemptId: attempt._id,
                timestamp: new Date(),
                label: 'Looking Away',
                severity: 'medium',
              });
            } catch (error) {
              console.error('[PROCTOR] Unable to persist looking-away evidence image:', error);
            }

            if (imageId) {
              await ProctoringLog.create({
                attemptId: attempt._id,
                timestamp: new Date(),
                label: 'Looking Away',
                severity: 'medium',
                imageId,
              });
              attempt.totalViolations += 1;
              attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - 5);
              await attempt.save();
            }
          }
        }
      }
    }

    res.status(200).json({ message: 'Activity events logged', count: docs.length });
  } catch (error: any) {
    console.error('Log activity events error:', error);
    res.status(200).json({ message: 'Activity events received (processing error logged)' });
  }
};