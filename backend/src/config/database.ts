import sql from "mssql";
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  ],
});

export interface DatabaseConfig {
  user: string;
  password: string;
  server: string;
  database: string;
  port: number;
  pool: {
    max: number;
    min: number;
    idleTimeoutMillis: number;
  };
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    enableArithAbort: boolean;
  };
}

const config: DatabaseConfig = {
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_DATABASE || "validis",
  port: parseInt(process.env.DB_PORT || "1433"),
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || "10"),
    min: parseInt(process.env.DB_POOL_MIN || "0"),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || "30000"),
  },
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== "false",
    enableArithAbort: true,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function initializeDatabase(): Promise<sql.ConnectionPool> {
  try {
    if (pool) {
      return pool;
    }

    logger.info("Initializing database connection pool...");
    pool = await sql.connect(config);

    // Test the connection
    await pool.request().query("SELECT 1 as test");
    logger.info("Database connection established successfully");

    return pool;
  } catch (error) {
    logger.error("Failed to initialize database connection:", error);
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
      pool = null;
      logger.info("Database connection pool closed");
    } catch (error) {
      logger.error("Error closing database connection:", error);
      throw error;
    }
  }
}

export function getPool(): sql.ConnectionPool {
  if (!pool) {
    throw new Error(
      "Database connection pool not initialized. Call initializeDatabase() first.",
    );
  }
  return pool;
}

export default {
  initializeDatabase,
  closeDatabase,
  getPool,
};
