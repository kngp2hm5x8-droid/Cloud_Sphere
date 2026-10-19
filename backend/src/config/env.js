import 'dotenv/config';

const required = ['DATABASE_URL'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET ?? '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
};

if (env.jwtSecret.length < 32 || /replace|change.?me|generate/i.test(env.jwtSecret)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters.');
}
