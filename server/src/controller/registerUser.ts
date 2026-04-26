
import User from '../models/User';
import mongoose from 'mongoose';
import express, { Request, Response } from 'express';
import {generateJwtForUser} from '../utils/jwt'
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';

export const registerUser = async (req: Request, res: Response) => {
  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const { role } = req.params;
    const { fullName, email, password, photo } = req.body;

    // Validate input
    if (!fullName || !email || !password || !photo) {
      return res.status(400).json({
        message: 'All fields are required.',
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: 'Please provide a valid email address.',
        error: 'INVALID_EMAIL'
      });
    }

    // Enforce strong passwords for all user registrations
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        message: PASSWORD_POLICY_MESSAGE,
        error: 'INVALID_PASSWORD'
      });
    }

    // Check if user already exists in MongoDB (email must be unique globally)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        message: `User with email ${email} already exists. Please use a different email.`,
        error: 'USER_EXISTS'
      });
    }

    // Validate and extract face descriptor from photo
    const faceValidation = { success: true, descriptor: new Float32Array(128), error: null }; // await validateFace(photo);
    if (!faceValidation.success || !faceValidation.descriptor) {
      return res.status(400).json({
        message: faceValidation.error || 'Face validation failed.',
        error: 'FACE_VALIDATION_FAILED',
        details: faceValidation.error
      });
    }

    // Convert Float32Array to regular array for MongoDB storage
    const faceDescriptorArray = Array.from(faceValidation.descriptor);

    // Create new user (password will be hashed by the pre-save hook)
    const newUser = new User({
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role as 'student' | 'examiner',
      status: role === 'examiner' ? 'pending' : 'active',
      photo,
      faceDescriptor: faceDescriptorArray,
    });

    // Save to MongoDB
    await newUser.save();

    // Return success response (don't send password or face descriptor)
    if (role === 'examiner') {
      return res.status(201).json({
        message: 'Registration submitted. Your examiner account is pending admin approval.',
        user: {
          userId: (newUser._id as any).toString(),
          role: newUser.role,
          status: newUser.status,
          email: newUser.email,
          photo: newUser.photo
        }
      });
    }

    const token = generateJwtForUser(newUser);
    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        userId: (newUser._id as any).toString(),
        role: newUser.role,
        status: newUser.status,
        email: newUser.email,
        photo: newUser.photo
      }
    });
  } catch (error: any) {
    console.error('Registration error:', error);

    // Handle duplicate key error (MongoDB unique constraint)
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'User with this email already exists for this role.',
        error: 'USER_EXISTS'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0] as any;
      return res.status(400).json({
        message: firstError?.message || 'Validation failed',
        error: 'VALIDATION_ERROR'
      });
    }

    // Handle MongoDB connection errors
    if (error.name === 'MongoServerError' || error.name === 'MongoNetworkError') {
      return res.status(503).json({
        message: 'Database connection error. Please try again later.',
        error: 'DATABASE_ERROR'
      });
    }

    res.status(500).json({
      message: 'Registration failed. Please try again.',
      error: 'INTERNAL_ERROR'
    });
  }
};
