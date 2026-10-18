import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import { notFound, errorHandler } from './middleware/errors.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev')); // logs method/URL/status only, never bodies

app.use('/api/health', healthRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
