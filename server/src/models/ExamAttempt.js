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
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const ExamAttemptSchema = new mongoose_1.Schema({
    testId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Test',
        required: true,
    },
    studentId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
                type: mongoose_1.Schema.Types.ObjectId,
                ref: 'Question',
            },
            answer: mongoose_1.Schema.Types.Mixed,
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
    // Store last captured frame (base64 data URI) for live monitoring
    latestFrame: {
        type: String,
    },
    latestFrameAt: {
        type: Date,
    },
}, {
    timestamps: true,
});
// ensure one attempt per student per test
ExamAttemptSchema.index({ testId: 1, studentId: 1 }, { unique: true });
const ExamAttempt = mongoose_1.default.model('ExamAttempt', ExamAttemptSchema);
exports.default = ExamAttempt;
