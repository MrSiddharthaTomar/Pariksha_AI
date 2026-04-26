import mongoose, { Document, Schema } from 'mongoose';

export interface IAdminSession extends Document {
  userId: mongoose.Types.ObjectId;
  tokenId: string;
  ipAddress: string;
  userAgent?: string;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSessionSchema = new Schema<IAdminSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    ipAddress: {
      type: String,
      required: true,
    },
    userAgent: {
      type: String,
    },
    lastActivityAt: {
      type: Date,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    revokedAt: {
      type: Date,
      index: true,
    },
  },
  { timestamps: true }
);

const AdminSession = mongoose.model<IAdminSession>('AdminSession', AdminSessionSchema);

export default AdminSession;

