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
const ProctoringLogSchema = new mongoose_1.Schema({
    attemptId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'ExamAttempt',
        required: true,
    },
    timestamp: {
        type: Date,
        required: true,
    },
    label: {
        type: String,
        enum: ['Phone Detected', 'Multiple Faces', 'No Person Visible', 'Audio Detected', 'Looking Away', 'Multiple Monitors'],
        required: true,
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high'],
        required: true,
    },
    imageId: {
        type: mongoose_1.Schema.Types.ObjectId,
    },
    // Review metadata (set by examiner)
    reviewed: {
        type: Boolean,
        default: false,
    },
    verdict: {
        type: String,
        enum: ['valid', 'invalid'],
    },
    reviewedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'User',
    },
    reviewedAt: {
        type: Date,
    },
    reviewerNotes: {
        type: String,
    },
}, {
    timestamps: true,
});
// Fast sorting & filtering
ProctoringLogSchema.index({ attemptId: 1 });
ProctoringLogSchema.index({ timestamp: 1 });
ProctoringLogSchema.index({ reviewed: 1 });
const ProctoringLog = mongoose_1.default.model('ProctoringLog', ProctoringLogSchema);
exports.default = ProctoringLog;
