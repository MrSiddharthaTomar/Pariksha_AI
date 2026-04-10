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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadFaceModels = loadFaceModels;
exports.detectAndExtractFaceDescriptor = detectAndExtractFaceDescriptor;
exports.compareFaces = compareFaces;
exports.validateFace = validateFace;
const faceapi = __importStar(require("face-api.js"));
const canvas_1 = require("canvas");
const tf = __importStar(require("@tensorflow/tfjs"));
require("@tensorflow/tfjs-backend-cpu");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Configure face-api.js to use canvas
faceapi.env.monkeyPatch({ Canvas: canvas_1.Canvas, Image: canvas_1.Image, ImageData: canvas_1.ImageData });
let modelsLoaded = false;
// Use path relative to project root - works in both ts-node and compiled code
// For development: __dirname = server/src/utils, so go up 2 levels to server
// For production: check multiple possible locations
const getModelPath = () => {
    // First, try relative to __dirname (most reliable)
    const pathFromDirname = path_1.default.resolve(__dirname, '../../models');
    if (fs_1.default.existsSync(pathFromDirname)) {
        return pathFromDirname;
    }
    // Second, try relative to process.cwd() (server directory)
    const pathFromCwd = path_1.default.resolve(process.cwd(), 'models');
    if (fs_1.default.existsSync(pathFromCwd)) {
        return pathFromCwd;
    }
    // Third, try from server root if running from different cwd
    const pathFromParent = path_1.default.resolve(process.cwd(), 'server', 'models');
    if (fs_1.default.existsSync(pathFromParent)) {
        return pathFromParent;
    }
    // Default fallback
    return pathFromDirname;
};
const MODEL_PATH = getModelPath();
// Load face-api.js models
async function loadFaceModels() {
    if (modelsLoaded) {
        return;
    }
    try {
        await tf.setBackend('cpu');
        await tf.ready();
        // Log the path being used for debugging
        console.log('Looking for models at:', MODEL_PATH);
        console.log('Current working directory:', process.cwd());
        console.log('Current __dirname:', __dirname);
        // Check if models directory exists, if not, create it
        if (!fs_1.default.existsSync(MODEL_PATH)) {
            fs_1.default.mkdirSync(MODEL_PATH, { recursive: true });
            console.log('⚠ Models directory created. Please download face-api.js models.');
            console.log('⚠ Download models from: https://github.com/justadudewhohacks/face-api.js-models');
            console.log('⚠ Place them in: ' + MODEL_PATH);
            throw new Error('Face recognition models not found. Please download and place models in the models directory.');
        }
        // Check if required model files exist
        const requiredFiles = [
            'tiny_face_detector_model-weights_manifest.json',
            'tiny_face_detector_model-shard1',
            'face_landmark_68_model-weights_manifest.json',
            'face_landmark_68_model-shard1',
            'face_recognition_model-weights_manifest.json',
            'face_recognition_model-shard1'
        ];
        const missingFiles = requiredFiles.filter(file => {
            const filePath = path_1.default.join(MODEL_PATH, file);
            return !fs_1.default.existsSync(filePath);
        });
        if (missingFiles.length > 0) {
            console.error('✗ Missing model files:', missingFiles);
            throw new Error(`Missing required model files: ${missingFiles.join(', ')}`);
        }
        console.log('Loading face recognition models...');
        // Load models with individual error handling
        try {
            await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_PATH);
            console.log('  ✓ Tiny Face Detector loaded');
        }
        catch (err) {
            console.error('  ✗ Failed to load Tiny Face Detector:', err.message);
            throw new Error(`Failed to load Tiny Face Detector model: ${err.message}`);
        }
        try {
            await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
            console.log('  ✓ Face Landmark 68 loaded');
        }
        catch (err) {
            console.error('  ✗ Failed to load Face Landmark 68:', err.message);
            throw new Error(`Failed to load Face Landmark model: ${err.message}`);
        }
        try {
            await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
            console.log('  ✓ Face Recognition Net loaded');
        }
        catch (err) {
            console.error('  ✗ Failed to load Face Recognition Net:', err.message);
            throw new Error(`Failed to load Face Recognition model: ${err.message}`);
        }
        modelsLoaded = true;
        console.log('✓ Face recognition models loaded successfully');
    }
    catch (error) {
        console.error('✗ Error loading face recognition models:', error.message);
        if (error.stack) {
            console.error('✗ Stack trace:', error.stack);
        }
        // Don't throw here - let the server start but mark models as not loaded
        // The validateFace function will check modelsLoaded and return appropriate error
        throw error;
    }
}
// Convert base64 image to buffer
function base64ToBuffer(base64String) {
    // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
}
// Detect and extract face descriptor from image
async function detectAndExtractFaceDescriptor(imageBase64) {
    try {
        // Convert base64 to buffer
        const imageBuffer = base64ToBuffer(imageBase64);
        // Load image using canvas loadImage
        const img = await (0, canvas_1.loadImage)(imageBuffer);
        // Create canvas and draw image
        const canvas = new canvas_1.Canvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        // Detect faces in the image using TinyFaceDetector
        const detections = await faceapi
            .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptors();
        if (detections.length === 0) {
            return null; // No face detected
        }
        if (detections.length > 1) {
            throw new Error('Multiple faces detected. Please ensure only one face is visible in the image.');
        }
        // Return the face descriptor (128-dimensional vector)
        return detections[0].descriptor;
    }
    catch (error) {
        if (error.message.includes('Multiple faces')) {
            throw error;
        }
        throw new Error('Failed to process image. Please ensure the image contains a clear face.');
    }
}
// Compare two face descriptors
function compareFaces(descriptor1, descriptor2, threshold = 0.6) {
    // Calculate Euclidean distance between descriptors
    let distance = 0;
    for (let i = 0; i < descriptor1.length; i++) {
        const diff = descriptor1[i] - descriptor2[i];
        distance += diff * diff;
    }
    distance = Math.sqrt(distance);
    // Lower distance means more similar faces
    // Threshold of 0.6 is a good balance (lower = stricter)
    return distance < threshold;
}
// Validate face in image (for registration/login)
async function validateFace(imageBase64) {
    try {
        // Check if models are loaded
        if (!modelsLoaded) {
            return {
                success: false,
                error: 'Face recognition models are not loaded. Please ensure models are downloaded and placed correctly.'
            };
        }
        if (!imageBase64 || imageBase64.trim() === '') {
            return { success: false, error: 'No image provided' };
        }
        const descriptor = await detectAndExtractFaceDescriptor(imageBase64);
        if (!descriptor) {
            return { success: false, error: 'No face detected in the image. Please ensure your face is clearly visible.' };
        }
        return { success: true, descriptor };
    }
    catch (error) {
        // Provide more specific error messages
        if (error.message.includes('Multiple faces')) {
            return { success: false, error: error.message };
        }
        if (error.message.includes('models')) {
            return { success: false, error: 'Face recognition models are not available. Please contact administrator.' };
        }
        return { success: false, error: error.message || 'Failed to process face image. Please try again with a clearer photo.' };
    }
}
