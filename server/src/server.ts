// ============================================
// Pariksha AI - Backend Server
// Production-ready Express.js + MongoDB setup
// ============================================

import express, { Request, Response, ErrorRequestHandler } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables FIRST before importing other modules
dotenv.config();

import mongoose from 'mongoose';
import router from './routes/routes';
import { runAttemptLifecycleSweep } from './controller/studentController';

// ============================================
// Environment Configuration
// ============================================
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pariksha-ai';
const CORS_ORIGIN = process.env.CORS_ORIGIN || (NODE_ENV === 'production' ? '' : 'http://localhost:5173');

// ============================================
// Express App Setup
// ============================================
const app = express();

// ============================================
// CORS Configuration
// ============================================
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);

    if (
      origin.includes('localhost') ||
      origin.includes('192.168.')
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

// ============================================
// Body Parser Middleware
// ============================================
app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));

// ============================================
// Health Check Endpoint (no auth required)
// ============================================
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ============================================
// API Routes
// ============================================
app.use('/api', router);

// ============================================
// 404 Handler
// ============================================
app.use((req: Request, res: Response) => {
  res.status(404).json({
    message: 'Not Found',
    path: req.path,
    method: req.method
  });
});

// ============================================
// Global Error Handler
// ============================================
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });

  // CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'CORS policy violation', error: err.message });
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: 'Validation error', error: err.message });
  }

  // Default error response
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    error: NODE_ENV === 'development' ? err : {}
  });
};

app.use(errorHandler);

// ============================================
// MongoDB Connection
// ============================================
const connectMongoDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ MongoDB connected successfully');
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error instanceof Error ? error.message : error);
    process.exit(1); // Exit if DB connection fails
  }
};

// ============================================
// Server Start
// ============================================
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectMongoDB();

    // Load face recognition models
    const { loadFaceModels } = await import('./utils/faceRecognition');
    await loadFaceModels();

    // Start listening
    const server = app.listen(PORT, () => {
      console.log('\n========================================');
      console.log('Pariksha AI Backend Server');
      console.log('========================================');

      console.log(`✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Environment: ${NODE_ENV}`);
      console.log(`✓ CORS Origin: ${CORS_ORIGIN || 'all'}`);
      console.log(`✓ Health check: GET /health`);
      console.log('========================================\n');
    });

    const lifecycleSweep = setInterval(async () => {
      try {
        if (mongoose.connection.readyState === 1) {
          await runAttemptLifecycleSweep();
        }
      } catch (error) {
        console.error('Attempt lifecycle sweep failed:', error);
      }
    }, 10000);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM signal received: closing HTTP server');
      clearInterval(lifecycleSweep);
      server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT signal received: closing HTTP server');
      clearInterval(lifecycleSweep);
      server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close();
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

export default app;
