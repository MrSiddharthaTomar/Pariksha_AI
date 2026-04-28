import mongoose, { Document, Schema } from 'mongoose';

export type AttemptEventType =
  | 'tab_hidden'
  | 'tab_visible'
  | 'window_blur'
  | 'window_focus'
  | 'fullscreen_enter'
  | 'fullscreen_exit'
  | 'question_time_spent'
  | 'warning_shown'
  | 'heartbeat'
  | 'session_exit'
  | 'auto_submitted';

export interface IAttemptEventLog extends Document {
  attemptId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  testId: mongoose.Types.ObjectId;
  eventType: AttemptEventType;
  timestamp: Date;
  questionId?: string;
  questionIndex?: number;
  durationMs?: number;
  meta?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const AttemptEventLogSchema = new Schema<IAttemptEventLog>(
  {
    attemptId: { type: Schema.Types.ObjectId, ref: 'ExamAttempt', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true, index: true },
    eventType: {
      type: String,
      enum: ['tab_hidden', 'tab_visible', 'window_blur', 'window_focus', 'fullscreen_enter', 'fullscreen_exit', 'question_time_spent', 'warning_shown', 'heartbeat', 'session_exit', 'auto_submitted'],
      required: true,
    },
    timestamp: { type: Date, required: true, index: true },
    questionId: { type: String },
    questionIndex: { type: Number },
    durationMs: { type: Number },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

AttemptEventLogSchema.index({ attemptId: 1, timestamp: -1 });

const AttemptEventLog = mongoose.model<IAttemptEventLog>('AttemptEventLog', AttemptEventLogSchema);
export default AttemptEventLog;

