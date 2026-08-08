import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/error-handler.js';

import authRoutes from './routes/auth/index.js';
import superadminRoutes from './routes/superadmin/index.js';
import agencyRoutes from './routes/agency/index.js';

const app = express();

// Render terminates TLS at a load balancer and forwards X-Forwarded-For.
// Trust exactly 1 hop so req.ip / express-rate-limit see the client IP
// without allowing spoofing via trust proxy = true.
app.set('trust proxy', 1);

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

// Error handler (must be last)
app.use(errorHandler);

export default app;
