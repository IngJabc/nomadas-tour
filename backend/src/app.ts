import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/error-handler.js';

import authRoutes from './routes/auth/index.js';
import superadminRoutes from './routes/superadmin/index.js';
import agencyRoutes from './routes/agency/index.js';
import customerRoutes from './routes/customer/index.js';

const app = express();

// Security
app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN.split(',').map(s => s.trim()),
  credentials: true,
}));

// Body parsing
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', superadminRoutes);       // superadmin only
app.use('/api/agency', agencyRoutes);           // agency role
app.use('/api', customerRoutes);                // public / optional auth

// Error handler (must be last)
app.use(errorHandler);

export default app;
