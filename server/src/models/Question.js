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
const QuestionSchema = new mongoose_1.Schema({
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
            validator(value) {
                if (this.type === 'mcq') {
                    return Array.isArray(value) && value.length >= 2;
                }
                return true;
            },
            message: 'MCQ questions require at least two options',
        },
    },
    correctAnswer: {
        type: mongoose_1.Schema.Types.Mixed,
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
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
}, {
    timestamps: true,
});
// indexing for fast search
QuestionSchema.index({ createdBy: 1 });
const Question = mongoose_1.default.model('Question', QuestionSchema);
exports.default = Question;
