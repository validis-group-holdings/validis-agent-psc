import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment variable schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  
  // Required application configuration
  WORKFLOW_MODE: z.enum(['audit', 'lending']),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required'),
  
  // Anthropic configuration
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_MODEL: z.string().default('claude-3-sonnet-20240229'),
  
  // Database configuration
  DB_SERVER: z.string().min(1, 'DB_SERVER is required'),
  DB_DATABASE: z.string().min(1, 'DB_DATABASE is required'),
  DB_USERNAME: z.string().min(1, 'DB_USERNAME is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
  DB_PORT: z.string().transform(Number).default('1433'),
  DB_ENCRYPT: z.string().transform(val => val === 'true').default('true'),
  DB_TRUST_SERVER_CERTIFICATE: z.string().transform(val => val === 'true').default('false'),
  
  // Redis configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  
  // Cache configuration
  CACHE_TTL_SECONDS: z.string().transform(Number).default('300'), // 5 minutes
  
  // Query limits
  MAX_QUERY_RESULTS: z.string().transform(Number).default('1000'),
  QUERY_TIMEOUT_MS: z.string().transform(Number).default('30000'), // 30 seconds
});

type EnvConfig = z.infer<typeof envSchema>;

class Config {
  private _config: EnvConfig | null = null;

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get port(): number {
    return this.config.PORT;
  }

  get workflowMode(): 'audit' | 'lending' {
    return this.config.WORKFLOW_MODE;
  }

  get clientId(): string {
    return this.config.CLIENT_ID;
  }

  get anthropic() {
    return {
      apiKey: this.config.ANTHROPIC_API_KEY,
      model: this.config.ANTHROPIC_MODEL,
    };
  }

  get database() {
    return {
      server: this.config.DB_SERVER,
      database: this.config.DB_DATABASE,
      user: this.config.DB_USERNAME,
      password: this.config.DB_PASSWORD,
      port: this.config.DB_PORT,
      options: {
        encrypt: this.config.DB_ENCRYPT,
        trustServerCertificate: this.config.DB_TRUST_SERVER_CERTIFICATE,
        requestTimeout: this.config.QUERY_TIMEOUT_MS,
      },
    };
  }

  get redis() {
    return {
      url: this.config.REDIS_URL,
      password: this.config.REDIS_PASSWORD,
    };
  }

  get cache() {
    return {
      ttlSeconds: this.config.CACHE_TTL_SECONDS,
    };
  }

  get queryLimits() {
    return {
      maxResults: this.config.MAX_QUERY_RESULTS,
      timeoutMs: this.config.QUERY_TIMEOUT_MS,
    };
  }

  private get config(): EnvConfig {
    if (!this._config) {
      throw new Error('Configuration not validated. Call validate() first.');
    }
    return this._config;
  }

  validate(): void {
    try {
      this._config = envSchema.parse(process.env);
      console.log('✅ Environment configuration validated successfully');
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('❌ Environment configuration validation failed:');
        error.errors.forEach((err) => {
          console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
      } else {
        console.error('❌ Unexpected error during configuration validation:', error);
      }
      throw new Error('Invalid environment configuration');
    }
  }

  isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  isTest(): boolean {
    return this.nodeEnv === 'test';
  }
}

export const config = new Config();