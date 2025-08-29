import sql from 'mssql';
<<<<<<< HEAD
import { config } from '@/config';
=======
import { config } from '../config';
>>>>>>> main

let connectionPool: sql.ConnectionPool | null = null;

export async function connectDatabase(): Promise<sql.ConnectionPool> {
  try {
    if (connectionPool && connectionPool.connected) {
      return connectionPool;
    }

    console.log('🔌 Connecting to SQL Server database...');
    
    const dbConfig: sql.config = {
      server: config.database.server,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      port: config.database.port,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
      options: {
        encrypt: config.database.options.encrypt,
        trustServerCertificate: config.database.options.trustServerCertificate,
        requestTimeout: config.database.options.requestTimeout,
        enableArithAbort: true,
      },
    };

    connectionPool = await sql.connect(dbConfig);
    
    console.log('✅ Successfully connected to SQL Server database');
    console.log(`   Server: ${config.database.server}`);
    console.log(`   Database: ${config.database.database}`);
    
    return connectionPool;
    
  } catch (error) {
    console.error('❌ Failed to connect to SQL Server database:', error);
    throw error;
  }
}

export function getDatabaseConnection(): sql.ConnectionPool {
  if (!connectionPool || !connectionPool.connected) {
    throw new Error('Database connection not established. Call connectDatabase() first.');
  }
  
  return connectionPool;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (connectionPool) {
    try {
      await connectionPool.close();
      connectionPool = null;
      console.log('✅ Database connection closed');
    } catch (error) {
      console.error('❌ Error closing database connection:', error);
    }
  }
}

// Health check function
export async function checkDatabaseHealth(): Promise<{ status: string; message: string }> {
  try {
    if (!connectionPool || !connectionPool.connected) {
      return { status: 'error', message: 'Database connection not established' };
    }

    // Simple test query
    const result = await connectionPool.request().query('SELECT 1 as test');
    
    if (result.recordset.length > 0 && result.recordset[0].test === 1) {
      return { status: 'healthy', message: 'Database connection is working' };
    } else {
      return { status: 'error', message: 'Database query returned unexpected result' };
    }
    
  } catch (error) {
    return { 
      status: 'error', 
      message: `Database health check failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

// Graceful shutdown handler
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database connection...');
  await closeDatabaseConnection();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database connection...');
  await closeDatabaseConnection();
});