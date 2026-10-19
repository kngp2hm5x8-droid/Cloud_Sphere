import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import { notFound, errorHandler } from './middleware/errors.js';
import apiRouter from './routes/v1.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  req.cookies = Object.fromEntries((req.headers.cookie ?? '').split(';').map((part) => {
    const i = part.indexOf('=');
    if (i < 0) return ['', ''];
    let value = part.slice(i + 1).trim();
    try { value = decodeURIComponent(value); } catch { return ['', '']; }
    return [part.slice(0, i).trim(), value];
  }).filter(([key]) => key));
  next();
});
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev')); // logs method/URL/status only, never bodies

app.use('/api/health', healthRouter);
app.use('/api/v1', apiRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
