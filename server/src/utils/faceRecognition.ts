import * as faceapi from 'face-api.js';
import { Canvas, Image, ImageData, loadImage } from 'canvas';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-cpu';
import path from 'path';
import fs from 'fs';

// Configure face-api.js to use canvas
faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);

let modelsLoaded = false;
// Use path relative to project root - works in both ts-node and compiled code
// For development: __dirname = server/src/utils, so go up 2 levels to server
// For production: check multiple possible locations
const getModelPath = (): string => {
  // First, try relative to __dirname (most reliable)
  const pathFromDirname = path.resolve(__dirname, '../../models');
  if (fs.existsSync(pathFromDirname)) {
    return pathFromDirname;
  }
  
  // Second, try relative to process.cwd() (server directory)
  const pathFromCwd = path.resolve(process.cwd(), 'models');
  if (fs.existsSync(pathFromCwd)) {
    return pathFromCwd;
  }
  
  // Third, try from server root if running from different cwd
  const pathFromParent = path.resolve(process.cwd(), 'server', 'models');
  if (fs.existsSync(pathFromParent)) {
    return pathFromParent;
  }
  
  // Default fallback
  return pathFromDirname;
};

const MODEL_PATH = getModelPath();

// Load face-api.js models
export async function loadFaceModels(): Promise<void> {
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
    if (!fs.existsSync(MODEL_PATH)) {
      fs.mkdirSync(MODEL_PATH, { recursive: true });
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
      'face_recognition_model-shard1',
      'face_recognition_model-shard2'
    ];

    const missingFiles = requiredFiles.filter(file => {
      const filePath = path.join(MODEL_PATH, file);
      return !fs.existsSync(filePath);
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
    } catch (err: any) {
      console.error('  ✗ Failed to load Tiny Face Detector:', err.message);
      throw new Error(`Failed to load Tiny Face Detector model: ${err.message}`);
    }
    
    try {
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
      console.log('  ✓ Face Landmark 68 loaded');
    } catch (err: any) {
      console.error('  ✗ Failed to load Face Landmark 68:', err.message);
      throw new Error(`Failed to load Face Landmark model: ${err.message}`);
    }
    
    try {
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
      console.log('  ✓ Face Recognition Net loaded');
    } catch (err: any) {
      console.error('  ✗ Failed to load Face Recognition Net:', err.message);
      throw new Error(`Failed to load Face Recognition model: ${err.message}`);
    }

    modelsLoaded = true;
    console.log('✓ Face recognition models loaded successfully');
  } catch (error: any) {
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
function base64ToBuffer(base64String: string): Buffer {
  // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
  const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64Data, 'base64');
}

// Detect and extract face descriptor from image
export async function detectAndExtractFaceDescriptor(
  imageBase64: string
): Promise<Float32Array | null> {
  try {
    // Convert base64 to buffer
    const imageBuffer = base64ToBuffer(imageBase64);
    
    // Load image using canvas loadImage
    const img = await loadImage(imageBuffer);

    // Create canvas and draw image
    const canvas = new Canvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    // Detect faces in the image using TinyFaceDetector
    const detections = await faceapi
      .detectAllFaces(canvas as any, new faceapi.TinyFaceDetectorOptions())
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
  } catch (error: any) {
    if (error.message.includes('Multiple faces')) {
      throw error;
    }
    throw new Error('Failed to process image. Please ensure the image contains a clear face.');
  }
}

// Compare two face descriptors
export function compareFaces(
  descriptor1: Float32Array,
  descriptor2: Float32Array,
  threshold: number = 0.6
): boolean {
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
export async function validateFace(imageBase64: string): Promise<{
  success: boolean;
  descriptor?: Float32Array;
  error?: string;
}> {
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
  } catch (error: any) {
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

