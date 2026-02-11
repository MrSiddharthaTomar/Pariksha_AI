import mongoose, { Document, Schema } from 'mongoose';

export type QuestionType = 'mcq' | 'coding' | 'subjective';

export interface ICodingTestCase {
  input: string;
  output: string;
  explanation?: string;
  hidden?: boolean;
}

export interface IQuestion extends Document {
  type: QuestionType;
  questionText: string;
  options?: string[]; // for MCQ
  correctAnswer?: any;
  marks: number;
  sampleInput?: string;
  sampleOutput?: string;
  constraints?: string;
  codingStarterCode?: string;
  codingFunctionSignature?: string;
  codingTestCases?: ICodingTestCase[];
  subjectiveRubric?: string;
  referenceAnswer?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionSchema = new Schema<IQuestion>(
  {
    type: {
      type: String,
      enum: ['mcq', 'coding', 'subjective'],
      required: true,
    },
    questionText: {
      type: String,
      required: true,
    },
    options: {
      type: [String],
      default: [],
      validate: {
        validator(this: IQuestion, value: string[]) {
          if (this.type === 'mcq') {
            return Array.isArray(value) && value.length >= 2;
          }
          return true;
        },
        message: 'MCQ questions require at least two options',
      },
    },
    correctAnswer: {
      type: Schema.Types.Mixed,
    },
    marks: {
      type: Number,
      default: 1,
    },
    sampleInput: {
      type: String,
    },
    sampleOutput: {
      type: String,
    },
    constraints: {
      type: String,
    },
    codingStarterCode: {
      type: String,
    },
    codingFunctionSignature: {
      type: String,
    },
    codingTestCases: [
      {
        input: { type: String, required: true },
        output: { type: String, required: true },
        explanation: { type: String },
        hidden: { type: Boolean, default: false },
      },
    ],
    subjectiveRubric: {
      type: String,
    },
    referenceAnswer: {
      type: String,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// indexing for fast search
QuestionSchema.index({ createdBy: 1 });

const Question = mongoose.model<IQuestion>('Question', QuestionSchema);

export default Question;


