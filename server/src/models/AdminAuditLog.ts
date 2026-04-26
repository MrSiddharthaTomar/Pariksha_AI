import mongoose, { Document, Schema } from 'mongoose';

export interface IAdminAuditLog extends Document {
  adminId: mongoose.Types.ObjectId;
  action: string;
  targetType: 'user' | 'test' | 'system';
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['user', 'test', 'system'],
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      trim: true,
      index: true,
    },
    details: {
      type: Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

const AdminAuditLog = mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);

export default AdminAuditLog;

