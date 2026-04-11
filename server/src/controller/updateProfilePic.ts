import {Request, Response} from 'express'
import User from '../models/User';
import mongoose from 'mongoose';

export const updateProfilePic = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Database connection not available. Please try again later.',
        error: 'DATABASE_UNAVAILABLE'
      });
    }

    const userId = (req as any).user.id;
    const { photo } = req.body;

    if (!photo) {
      return res.status(400).json({
        message: 'Photo is required.',
        error: 'MISSING_FIELDS'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.photo = photo;
    await user.save();

    res.status(200).json({
      message: 'Profile photo updated successfully',
      user: {
        id: (user._id as any).toString(),
        name: user.fullName,
        role: user.role,
        email: user.email,
        photo: user.photo
      }
    });
  } catch (error: any) {
    console.error('Profile image update error:', error);
    res.status(500).json({
      message: 'Failed to update profile photo.',
      error: 'INTERNAL_ERROR'
    });
  }
};