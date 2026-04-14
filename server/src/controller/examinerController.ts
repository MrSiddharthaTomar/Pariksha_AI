import { Request, Response } from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Test from '../models/Test';
import TestRecording from '../models/TestRecording';
import ProctoringLog from '../models/ProctoringLog';
import Question from '../models/Question';
import ExamAttempt from '../models/ExamAttempt';
import { getCheatingImagesBucket } from '../utils/gridfs';

export const examinerDashboard = async (req: Request, res: Response) => {
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
    res.status(500).json({ message: 'Failed to fetch dashboard data.', error: error.message });
    console.log(error);
  }
};

export const createTest = async (req: Request, res: Response) => {
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
    console.log('[CreateTest] Received questions:', JSON.stringify(questions, null, 2));

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
        codingTestCases: type === 'coding'
          ? (q.codingTestCases || [])
              .filter((tc: any) => (tc?.input || '').toString().trim() || (tc?.output || '').toString().trim())
              .map((tc: any) => ({
                input: (tc.input || '').toString().trim(),
                output: (tc.output || '').toString().trim(),
                explanation: tc.explanation,
                hidden: tc.hidden
              }))
          : undefined,
        subjectiveRubric: q.subjectiveRubric,
        referenceAnswer: q.referenceAnswer,
      });
    }

    console.log('[CreateTest] Sanitized questions:', JSON.stringify(sanitizedQuestions, null, 2));

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

    res.status(500).json({ message: 'Failed to create test.', error: error.message });
  }
};

export const getTestDetails = async (req: Request, res: Response) => {
  const { testId } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available.', error: 'DATABASE_UNAVAILABLE' });
    }

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ message: 'Test not found' });

    // Fetch questions
    const questionIds = test.questionIds || [];
    const questionDocs = await Question.find({ _id: { $in: questionIds } });

    console.log(`[EditTest] TestId: ${testId}, Found ${questionDocs.length} questions`);

    // Maintain order
    const questionMap = new Map(questionDocs.map((q: any) => [q._id.toString(), q]));
    const questions = questionIds.map((id: any) => {
      const q = questionMap.get(id.toString());
      if (!q) return null;

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
  } catch (error: any) {
    console.error('Fetch test for edit error:', error);
    res.status(500).json({ message: 'Failed to fetch test' });
  }
};

export const updateTest = async (req: Request, res: Response) => {
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
};

export const generateQuestionsAI = async (req: Request, res: Response) => {
  const { aiPrompt } = req.body;

  if (!aiPrompt || aiPrompt.trim().length === 0) {
    return res.status(400).json({ message: 'AI prompt is required' });
  }

  // Check if any AI API key is available
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    console.warn('No AI API keys configured for AI generation.');
    return res.status(500).json({
      message: 'AI generation is not available because no AI provider keys are configured.',
      error: 'Missing OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY'
    });
  }

  try {
    let questions: any[] = [];

    // Try OpenAI first if available
    if (process.env.OPENAI_API_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
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
    if (questions.length === 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
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

    // Fallback to Gemini if Anthropic failed or not available
    if (questions.length === 0 && process.env.GEMINI_API_KEY) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Generate multiple choice test questions based on: ${aiPrompt}. Return JSON array format: [{"question": "text", "options": ["opt1", "opt2", "opt3", "opt4"], "correctAnswer": 0}]`
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1500,
              topP: 0.95
            }
          })
        });

        const responseText = await response.text();
        if (response.ok) {
          const data = JSON.parse(responseText || '{}');
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

          if (content) {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              questions = parsed.map((q: any, idx: number) => ({
                id: idx + 1,
                question: q.question || '',
                options: q.options || ['', '', '', ''],
                correctAnswer: q.correctAnswer || 0
              }));
            } else {
              console.warn('Gemini response could not be parsed as JSON array:', content);
            }
          } else {
            console.warn('Gemini response returned no text content:', data);
          }
        } else {
          console.error('Gemini non-ok response:', response.status, responseText);
        }
      } catch (error) {
        console.error('Gemini API error:', error);
      }
    }

    // If still no valid questions were generated, fail clearly
    if (questions.length === 0) {
      console.error('AI generation failed: no valid questions generated.');
      return res.status(500).json({
        message: 'Unable to generate questions at this time. Please try again later.',
        error: 'AI generation returned no valid question data'
      });
    }

    res.status(200).json({
      message: "AI generation complete. Review questions below.",
      questions: questions
    });
  } catch (error) {
    console.error('AI generation error:', error);
    res.status(500).json({ message: 'Failed to generate questions. Please try again.' });
  }
};

export const getTestResults = async (req: Request, res: Response) => {
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
      const fallbackScore = (a.answers || []).reduce((acc: number, answer: any) => acc + (answer?.marksObtained ?? 0), 0);
      return {
        attemptId: (a._id as any).toString(),
        studentId: (student?._id as any)?.toString() || null,
        name: student?.fullName || student?.name || 'Unknown',
        email: student?.email || 'unknown',
        actualScore: typeof a.totalScore === 'number' ? a.totalScore : fallbackScore,
        trustScore: a.trustScore ?? 100,
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
};

export const deleteTest = async (req: Request, res: Response) => {
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
};

export const getStudentReport = async (req: Request, res: Response) => {
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

    const fallbackScore = (attempt.answers || []).reduce((acc: number, answer: any) => acc + (answer?.marksObtained ?? 0), 0);
    const computedDuration = attempt.duration ?? (attempt.startedAt && attempt.endedAt ? Math.max(0, Math.round((attempt.endedAt.getTime() - attempt.startedAt.getTime()) / 60000)) : undefined);

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
        duration: computedDuration,
        totalScore: typeof attempt.totalScore === 'number' ? attempt.totalScore : fallbackScore,
        trustScore: attempt.trustScore ?? 100,
        totalViolations: attempt.totalViolations ?? logs.length,
        questionsAttempted: attempt.questionsAttempted ?? attempt.answers?.length ?? 0,
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
};
export const getStudents = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    const students = await User.find({ role: 'student' }).select('fullName email _id');
    res.status(200).json({ students });
  } catch (error: any) {
    console.error('Fetch students error:', error);
    res.status(500).json({ message: 'Failed to fetch students', error: error.message });
  }
};

export const getLiveTests = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Database connection not available. Please try again later.', error: 'DATABASE_UNAVAILABLE' });
    }

    const now = new Date();

    // Include tests that are explicitly active/running OR whose scheduled window includes now
    const unreviewedLogGroups = await ProctoringLog.aggregate([
      { $match: { reviewed: false } },
      { $lookup: { from: 'examattempts', localField: 'attemptId', foreignField: '_id', as: 'attempt' } },
      { $unwind: '$attempt' },
      { $group: { _id: '$attempt.testId', count: { $sum: 1 } } }
    ]);

    const unreviewedTestIds = unreviewedLogGroups.map((group: any) => group._id);
    const unreviewedMap: Record<string, number> = {};
    unreviewedLogGroups.forEach((group: any) => {
      if (group._id) {
        unreviewedMap[(group._id as any).toString()] = group.count;
      }
    });

    const liveTests = await Test.find({
      $or: [
        { status: { $in: ['active', 'running'] } },
        { startTime: { $lte: now }, endTime: { $gte: now } },
        { _id: { $in: unreviewedTestIds } }
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
        unreviewedViolations: unreviewedMap[(t._id as any).toString()] || 0,
      };
    }));

    res.status(200).json({ tests: testsWithStats });
  } catch (error: any) {
    console.error('Fetch live tests error:', error);
    res.status(500).json({ message: 'Failed to fetch live tests', error: error?.message });
  }
};

export const getMonitorEvents = async (req: Request, res: Response) => {
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
      reviewed: !!log.reviewed,
      verdict: log.verdict || null,
      reviewedAt: log.reviewedAt || null,
      reviewerNotes: log.reviewerNotes || null,
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
};

export const reviewProctoringLog = async (req: Request, res: Response) => {
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

    if (previousVerdict === 'invalid' && verdict === 'valid') {
      attempt.totalViolations = (attempt.totalViolations || 0) + 1;
      attempt.trustScore = Math.max(0, (attempt.trustScore || 100) - penalty);
      await attempt.save();
    } else if (verdict === 'invalid' && previousVerdict !== 'invalid') {
      attempt.totalViolations = Math.max(0, (attempt.totalViolations || 0) - 1);
      attempt.trustScore = Math.min(100, (attempt.trustScore || 100) + penalty);
      await attempt.save();
    }

    res.status(200).json({ message: 'Review applied', log, attempt: { attemptId: (attempt._id as any).toString(), trustScore: attempt.trustScore, totalViolations: attempt.totalViolations } });
  } catch (error: any) {
    console.error('Review log error:', error);
    res.status(500).json({ message: 'Failed to apply review', error: error?.message });
  }
};

export const getMonitorAttempts = async (req: Request, res: Response) => {
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
};

export const getProctoringImage = async (req: Request, res: Response) => {
  const { imageId } = req.params;
  try {
    // allow token via Authorization header or query param (?token=...)
    let token: string | undefined;
    const authHeader = (req.headers['authorization'] || '') as string;
    if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.split(' ')[1];
    if (!token && req.query && (req.query as any).token) token = (req.query as any).token;

    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try { jwt.verify(token, process.env.JWT_SECRET!); } catch (err) { return res.status(401).json({ message: 'Invalid token' }); }

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
};