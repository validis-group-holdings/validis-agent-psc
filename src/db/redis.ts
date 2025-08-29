import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { QueryResult } from '../types';

let redisClient: RedisClientType | null = null;

export async function connectRedis(): Promise<RedisClientType> {
  try {
    if (redisClient && redisClient.isOpen) {
      return redisClient;
    }

    console.log('🔌 Connecting to Redis...');
    
    const clientOptions: any = {
      url: config.redis.url,
    };
    
    if (config.redis.password) {
      clientOptions.password = config.redis.password;
    }
    
    redisClient = createClient(clientOptions);
    
    redisClient.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });
    
    redisClient.on('connect', () => {
      console.log('🔄 Redis client connecting...');
    });
    
    redisClient.on('ready', () => {
      console.log('✅ Redis client ready');
    });
    
    redisClient.on('end', () => {
      console.log('🔚 Redis client connection ended');
    });

    await redisClient.connect();
    
    console.log('✅ Successfully connected to Redis');
    console.log(`   URL: ${config.redis.url}`);
    
    return redisClient;
    
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    throw error;
  }
}

export function getRedisClient(): RedisClientType {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis connection not established. Call connectRedis() first.');
  }
  
  return redisClient;
}

export async function closeRedisConnection(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.disconnect();
      redisClient = null;
      console.log('✅ Redis connection closed');
    } catch (error) {
      console.error('❌ Error closing Redis connection:', error);
    }
  }
}

// Cache key generators
export function generateQueryCacheKey(query: string, clientId: string, workflowMode: string): string {
  const queryHash = Buffer.from(query).toString('base64').slice(0, 32);
  return `query:${workflowMode}:${clientId}:${queryHash}`;
}

export function generateTableCacheKey(tableName: string, clientId: string): string {
  return `table:${clientId}:${tableName}`;
}

// Cache management functions
export async function cacheQueryResult(
  cacheKey: string, 
  result: QueryResult, 
  ttlSeconds: number = config.cache.ttlSeconds
): Promise<void> {
  try {
    const client = getRedisClient();
    const serializedResult = JSON.stringify(result);
    
    await client.setEx(cacheKey, ttlSeconds, serializedResult);
    console.log(`📝 Cached query result with key: ${cacheKey}`);
    
  } catch (error) {
    console.error('❌ Error caching query result:', error);
    // Don't throw error - caching failure shouldn't break the application
  }
}

export async function getCachedQueryResult(cacheKey: string): Promise<QueryResult | null> {
  try {
    const client = getRedisClient();
    const cachedResult = await client.get(cacheKey);
    
    if (cachedResult) {
      console.log(`📖 Retrieved cached query result with key: ${cacheKey}`);
      return JSON.parse(cachedResult);
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Error retrieving cached query result:', error);
    return null; // Return null on error to allow fresh query
  }
}

export async function invalidateCache(pattern: string): Promise<number> {
  try {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    
    if (keys.length > 0) {
      const deletedCount = await client.del(keys);
      console.log(`🗑️ Invalidated ${deletedCount} cache entries matching pattern: ${pattern}`);
      return deletedCount;
    }
    
    return 0;
    
  } catch (error) {
    console.error('❌ Error invalidating cache:', error);
    return 0;
  }
}

export async function cacheTableList(clientId: string, tables: string[], ttlSeconds: number = 1800): Promise<void> {
  try {
    const client = getRedisClient();
    const cacheKey = `tables:${clientId}`;
    const serializedTables = JSON.stringify(tables);
    
    await client.setEx(cacheKey, ttlSeconds, serializedTables);
    console.log(`📝 Cached table list for client: ${clientId}`);
    
  } catch (error) {
    console.error('❌ Error caching table list:', error);
  }
}

export async function getCachedTableList(clientId: string): Promise<string[] | null> {
  try {
    const client = getRedisClient();
    const cacheKey = `tables:${clientId}`;
    const cachedTables = await client.get(cacheKey);
    
    if (cachedTables) {
      console.log(`📖 Retrieved cached table list for client: ${clientId}`);
      return JSON.parse(cachedTables);
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Error retrieving cached table list:', error);
    return null;
  }
}

// Health check function
export async function checkRedisHealth(): Promise<{ status: string; message: string }> {
  try {
    if (!redisClient || !redisClient.isOpen) {
      return { status: 'error', message: 'Redis connection not established' };
    }

    // Test Redis with a simple ping
    const response = await redisClient.ping();
    
    if (response === 'PONG') {
      return { status: 'healthy', message: 'Redis connection is working' };
    } else {
      return { status: 'error', message: 'Redis ping returned unexpected response' };
    }
    
  } catch (error) {
    return { 
      status: 'error', 
      message: `Redis health check failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing Redis connection...');
  await closeRedisConnection();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing Redis connection...');
  await closeRedisConnection();
});