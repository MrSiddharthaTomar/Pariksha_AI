import mongoose, { Document, Schema } from 'mongoose';

export type ExamAttemptStatus = 'not-started' | 'in-progress' | 'submitted' | 'blocked';

export interface IAnswer {
  questionId: mongoose.Types.ObjectId;
  answer: any;
  isCorrect?: boolean;
  marksObtained?: number;
}

export interface IExamAttempt extends Document {
  testId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  status: ExamAttemptStatus;
  startedAt?: Date;
  endedAt?: Date;
  duration?: number;
  answers: IAnswer[];
  totalScore: number;
  trustScore: number;
  totalViolations: number;
  questionsAttempted: number;
  // Progress tracking fields
  currentQuestionIndex?: number;
  timeRemaining?: number;
  partialAnswers?: Record<string, any>;
  // Session tracking for logout handling
  lastLogoutAt?: Date;
  sessionWarningsShown?: number;
  // latest frame data uri for live monitoring (optional)
  latestFrame?: string;
  latestFrameAt?: Date;
  questionOrder?: string[];
  optionOrderByQuestion?: Record<string, number[]>;
  createdAt: Date;
  updatedAt: Date;
}

const ExamAttemptSchema = new Schema<IExamAttempt>(
  {
    testId: {
      type: Schema.Types.ObjectId,
      ref: 'Test',
      required: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['not-started', 'in-progress', 'submitted', 'blocked'],
      default: 'in-progress',
    },
    startedAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    duration: {
      type: Number,
    },
    answers: [
      {
        questionId: {
          type: Schema.Types.ObjectId,
          ref: 'Question',
        },
        answer: Schema.Types.Mixed,
        isCorrect: {
          type: Boolean,
        },
        marksObtained: {
          type: Number,
        },
      },
    ],
    totalScore: {
      type: Number,
      default: 0,
    },
    trustScore: {
      type: Number,
      default: 100,
    },
    totalViolations: {
      type: Number,
      default: 0,
    },
    questionsAttempted: {
      type: Number,
      default: 0,
    },
    // Progress tracking fields
    currentQuestionIndex: {
      type: Number,
      default: 0,
    },
    timeRemaining: {
      type: Number,
    },
    partialAnswers: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // Session tracking for logout handling
    lastLogoutAt: {
      type: Date,
    },
    sessionWarningsShown: {
      type: Number,
      default: 0,
    },
    // Store last captured frame (base64 data URI) for live monitoring
    latestFrame: {
      type: String,
    },
    latestFrameAt: {
      type: Date,
    },
    // Stable per-attempt randomization maps
    questionOrder: {
      type: [String],
      default: [],
    },
    optionOrderByQuestion: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// ensure one attempt per student per test
ExamAttemptSchema.index({ testId: 1, studentId: 1 }, { unique: true });

const ExamAttempt = mongoose.model<IExamAttempt>('ExamAttempt', ExamAttemptSchema);

export default ExamAttempt;


