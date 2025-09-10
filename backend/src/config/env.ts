import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Define the environment schema
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  HOST: z.string().default('localhost'),

  // Database
  MSSQL_SERVER: z.string(),
  MSSQL_DATABASE: z.string(),
  MSSQL_USER: z.string(),
  MSSQL_PASSWORD: z.string(),
  MSSQL_PORT: z.string().transform(Number).default('1433'),
  MSSQL_ENCRYPT: z.string().transform(val => val === 'true').default('false'),
  MSSQL_TRUST_SERVER_CERTIFICATE: z.string().transform(val => val === 'true').default('true'),
  MSSQL_POOL_MIN: z.string().transform(Number).default('2'),
  MSSQL_POOL_MAX: z.string().transform(Number).default('10'),
  MSSQL_POOL_IDLE_TIMEOUT: z.string().transform(Number).default('30000'),

  // Anthropic
  ANTHROPIC_API_KEY: z.string(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
  ANTHROPIC_MAX_TOKENS: z.string().transform(Number).default('4096'),
  ANTHROPIC_TEMPERATURE: z.string().transform(Number).default('0.7'),

  // API
  API_RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('60000'),
  API_RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'simple']).default('json'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  CORS_CREDENTIALS: z.string().transform(val => val === 'true').default('true'),
});

// Parse and validate environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Invalid environment variables:', error.flatten().fieldErrors);
      process.exit(1);
    }
    throw error;
  }
};

export const env = parseEnv();

// Type export for TypeScript
export type Env = z.infer<typeof envSchema>;
