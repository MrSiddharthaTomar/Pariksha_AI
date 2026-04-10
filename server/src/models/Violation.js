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
const ViolationSchema = new mongoose_1.Schema({
    studentId: {
        type: String,
        required: [true, 'Student ID is required'],
        index: true,
    },
    testId: {
        type: String,
        required: [true, 'Test ID is required'],
        index: true,
    },
    timestamp: {
        type: Date,
        required: [true, 'Timestamp is required'],
        default: Date.now,
    },
    type: {
        type: String,
        required: [true, 'Violation type is required'],
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high'],
        required: [true, 'Severity is required'],
    },
    image: {
        type: String,
        required: [true, 'Image is required'],
    },
    confidence: {
        type: Number,
        min: 0,
        max: 1,
    },
    description: {
        type: String,
    },
}, {
    timestamps: true,
});
// Create indexes for faster queries
ViolationSchema.index({ studentId: 1, testId: 1 });
ViolationSchema.index({ timestamp: -1 });
const Violation = mongoose_1.default.model('Violation', ViolationSchema);
exports.default = Violation;
