import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcrypt';

export interface IUser extends Document {
  fullName: string;
  email: string;
  password: string;
  role: 'student' | 'examiner' | 'admin';
  status: 'pending' | 'approved' | 'rejected' | 'active' | 'suspended';
  rejectionReason?: string;
  photo?: string; // Base64 image for display
  faceDescriptor?: number[]; // Face descriptor array for face recognition
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true, // Email must be unique globally (not per role)
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
    },
    role: {
      type: String,
      enum: ['student', 'examiner', 'admin'],
      required: [true, 'Role is required'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'active', 'suspended'],
      default: 'active',
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Rejection reason cannot exceed 500 characters'],
    },
    photo: {
      type: String,
      required: function (this: IUser) {
        return this.role !== 'admin';
      },
    },
    faceDescriptor: {
      type: [Number],
      required: function (this: IUser) {
        return this.role !== 'admin';
      },
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // Hash password with cost of 10
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

// Method to compare password for login
UserSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model<IUser>('User', UserSchema);

export default User;

