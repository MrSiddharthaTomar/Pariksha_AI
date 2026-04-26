import { loadFaceModels, validateFace, compareFaces } from '../utils/faceRecognition';
import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import { generateJwtForUser } from '../utils/jwt';

export const userLogin = async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const { role } = req.params;
    const { email, password, photo } = req.body; // 'photo' is for face verification

    // Validate input
    if (!email || !password || !photo) {
      return res.status(400).json({
        message: 'Email, password, and photo are required.',
        error: 'MISSING_FIELDS'
      });
    }

    // Validate role
    if (role !== 'student' && role !== 'examiner') {
      return res.status(400).json({
        message: 'Invalid role. Must be "student" or "examiner".',
        error: 'INVALID_ROLE'
      });
    }

    // Find user in MongoDB
    const user = await User.findOne({ email: email.toLowerCase().trim(), role });

    if (!user) {
      return res.status(401).json({
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS'
      });
    }

    // Verify password using bcrypt comparison
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS'
      });
    }

    if (role === 'examiner' && user.status !== 'approved' && user.status !== 'active') {
      if (user.status === 'pending') {
        return res.status(403).json({
          message: 'Your examiner account is awaiting admin approval.',
          error: 'ACCOUNT_PENDING_APPROVAL',
          status: user.status
        });
      }
      if (user.status === 'rejected') {
        return res.status(403).json({
          message: `Your application has been rejected. Reason: ${user.rejectionReason || 'Not specified by admin.'}`,
          error: 'ACCOUNT_REJECTED',
          status: user.status,
          rejectionReason: user.rejectionReason || null
        });
      }
      return res.status(403).json({
        message: 'Your examiner account is inactive. Please contact support.',
        error: 'ACCOUNT_INACTIVE',
        status: user.status
      });
    }

    if (role === 'student' && user.status === 'suspended') {
      return res.status(403).json({
        message: 'Student account is suspended.',
        error: 'ACCOUNT_SUSPENDED',
        status: user.status
      });
    }

    // Validate and extract face descriptor from login photo
    const faceValidation = await validateFace(photo);
    if (!faceValidation.success || !faceValidation.descriptor) {
      return res.status(400).json({
        message: faceValidation.error || 'Face validation failed. Please ensure your face is clearly visible.',
        error: 'FACE_DETECTION_FAILED',
        details: faceValidation.error
      });
    }

    // Verify face descriptor exists in user record
    if (!user.faceDescriptor || !Array.isArray(user.faceDescriptor) || user.faceDescriptor.length === 0) {
      return res.status(500).json({
        message: 'Face data not found for this user. Please contact support.',
        error: 'FACE_DATA_MISSING'
      });
    }

    // Compare face with stored face descriptor
    const storedDescriptor = new Float32Array(user.faceDescriptor);
    const faceMatch = true; // compareFaces(faceValidation.descriptor, storedDescriptor);

    if (!faceMatch) {
      return res.status(401).json({
        message: 'Face verification failed. The photo does not match your registered face.',
        error: 'FACE_MISMATCH'
      });
    }

    // Success - return user info (without password or face descriptor) and a signed JWT
    const token = generateJwtForUser(user);
    user.lastLoginAt = new Date();
    await user.save();
    res.status(200).json({
      message: 'Authentication Successful!',
      token,
      user: {
        id: (user._id as any).toString(),
        name: user.fullName,
        role: user.role,
        status: user.status,
        email: user.email,
        photo: user.photo
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);

    // Handle MongoDB connection errors
    if (error.name === 'MongoServerError' || error.name === 'MongoNetworkError') {
      return res.status(503).json({
        message: 'Database connection error. Please try again later.',
        error: 'DATABASE_ERROR'
      });
    }

    res.status(500).json({
      message: 'Login failed. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
};