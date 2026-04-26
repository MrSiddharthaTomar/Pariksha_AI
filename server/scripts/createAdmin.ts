import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../src/utils/passwordPolicy';

dotenv.config();

const run = async () => {
  const [email, password, fullName] = process.argv.slice(2);
  if (!email || !password || !fullName) {
    console.error('Usage: ts-node scripts/createAdmin.ts <email> <password> <fullName>');
    process.exit(1);
  }

  if (!isStrongPassword(password)) {
    console.error(PASSWORD_POLICY_MESSAGE);
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pariksha-ai';
  await mongoose.connect(uri);

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    console.error('User already exists with this email.');
    process.exit(1);
  }

  const admin = new User({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    password,
    role: 'admin',
    status: 'active',
  });

  await admin.save();
  console.log(`Admin created: ${admin.email}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Failed to create admin:', error);
  await mongoose.disconnect();
  process.exit(1);
});

