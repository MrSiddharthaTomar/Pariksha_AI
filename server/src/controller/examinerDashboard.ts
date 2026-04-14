import { Request, Response } from 'express';
import User from '../models/User';
import Test from "../models/Test";
import ProctoringLog from '../models/ProctoringLog';


export const examinerDashboard = async (req: Request, res: Response) => {
  try {
    const [totalTests, completedTests, scheduledTests, studentCount, recentTests] = await Promise.all([
      Test.countDocuments({}),
      Test.countDocuments({ status: 'completed' }),
      Test.countDocuments({ status: { $in: ['scheduled', 'active', 'running'] } }),
      User.countDocuments({ role: 'student' }),
      Test.find({}).sort({ createdAt: -1 }).limit(10),
    ]);

    const activeStudents = studentCount;

    // compute unreviewed proctoring logs per test
    const unreviewedAgg = await ProctoringLog.aggregate([
      { $match: { reviewed: false } },
      { $lookup: { from: 'examattempts', localField: 'attemptId', foreignField: '_id', as: 'attempt' } },
      { $unwind: '$attempt' },
      { $group: { _id: '$attempt.testId', count: { $sum: 1 } } },
    ]);

    const unreviewedMap: Record<string, number> = {};
    unreviewedAgg.forEach((r: any) => { unreviewedMap[(r._id as any).toString()] = r.count; });

    const dashboardData = {
      stats: [
        { label: 'Total Tests', value: totalTests.toString(), color: 'primary' },
        { label: 'Active Students', value: activeStudents.toString(), color: 'secondary' },
        { label: 'Completed', value: completedTests.toString(), color: 'success' },
        { label: 'Scheduled', value: scheduledTests.toString(), color: 'warning' },
      ],
      tests: recentTests.map((t) => ({
        id: (t._id as any).toString(),
        name: t.name,
        date: t.startTime ? t.startTime.toISOString().split('T')[0] : '',
        students: t.allowedStudents?.length || 0,
        status: t.status,
        startTime: t.startTime ? t.startTime.toISOString() : null,
        endTime: t.endTime ? t.endTime.toISOString() : null,
        unreviewedViolations: unreviewedMap[(t._id as any).toString()] || 0,
      })),
      unreviewedTotal: unreviewedAgg.reduce((acc: number, cur: any) => acc + (cur.count || 0), 0),
    };

    res.status(200).json(dashboardData);
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data.', error: error.message });
    console.log(error);
  }
};