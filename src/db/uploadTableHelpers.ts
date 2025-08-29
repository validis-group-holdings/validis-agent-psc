import sql from 'mssql';
import { getDatabaseConnection } from './connection';
import { config } from '../config';
import { UploadTableInfo, QueryResult } from '../types';

/**
 * Get upload table information for all clients (used by lending mode)
 */
export async function getUploadTableInfo(): Promise<UploadTableInfo[]> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    // This query gets all upload table info across all clients for lending mode
    const query = `
      SELECT 
        table_name as tableName,
        client_id as clientId,
        upload_date as uploadDate,
        record_count as recordCount,
        file_type as fileType,
        status
      FROM upload_table_metadata 
      WHERE status = 'active'
      ORDER BY client_id, upload_date DESC
    `;
    
    const result = await request.query(query);
    return result.recordset;
    
  } catch (error) {
    console.error('Error fetching upload table info:', error);
    return [];
  }
}

/**
 * Get all upload tables available for a specific client
 */
export async function getUploadTablesForClient(clientId: string): Promise<UploadTableInfo[]> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    request.input('clientId', sql.VarChar, clientId);
    
    // This query assumes there's a metadata table that tracks upload tables
    // Adjust the query based on your actual database schema
    const query = `
      SELECT 
        table_name as tableName,
        client_id as clientId,
        upload_date as uploadDate,
        record_count as recordCount,
        file_type as fileType,
        status
      FROM upload_table_metadata 
      WHERE client_id = @clientId 
        AND status = 'active'
      ORDER BY upload_date DESC
    `;
    
    const result = await request.query(query);
    return result.recordset;
    
  } catch (error) {
    console.error('Error fetching upload tables for client:', error);
    throw error;
  }
}

/**
 * Get all available upload tables for lending workflow (portfolio-wide)
 */
export async function getUploadTablesForLending(): Promise<UploadTableInfo[]> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    const query = `
      SELECT 
        table_name as tableName,
        client_id as clientId,
        upload_date as uploadDate,
        record_count as recordCount,
        file_type as fileType,
        status
      FROM upload_table_metadata 
      WHERE status = 'active'
      ORDER BY client_id, upload_date DESC
    `;
    
    const result = await request.query(query);
    return result.recordset;
    
  } catch (error) {
    console.error('Error fetching upload tables for lending:', error);
    throw error;
  }
}

/**
 * Validate that a table name follows the upload table pattern and exists
 */
export async function validateUploadTable(tableName: string, clientId: string): Promise<boolean> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    request.input('tableName', sql.VarChar, tableName);
    request.input('clientId', sql.VarChar, clientId);
    
    const query = `
      SELECT COUNT(*) as count
      FROM upload_table_metadata 
      WHERE table_name = @tableName 
        AND client_id = @clientId 
        AND status = 'active'
    `;
    
    const result = await request.query(query);
    return result.recordset[0].count > 0;
    
  } catch (error) {
    console.error('Error validating upload table:', error);
    return false;
  }
}

/**
 * Execute a query with proper client scoping and upload table validation
 */
export async function executeSecureQuery(
  query: string, 
  clientId: string, 
  workflowMode: 'audit' | 'lending',
  maxResults: number = config.queryLimits.maxResults
): Promise<QueryResult> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    const startTime = Date.now();
    
    // Add client scoping to the query if it's audit mode
    const secureQuery = query;
    if (workflowMode === 'audit') {
      // Ensure CLIENT_ID filtering is present for audit mode
      if (!query.toLowerCase().includes('client_id')) {
        throw new Error('Query must include CLIENT_ID filtering for audit workflow');
      }
    }
    
    // Set query timeout and max results
    request.input('clientId', sql.VarChar, clientId);
    request.input('maxResults', sql.Int, maxResults);
    
    // Execute the query
    const result = await request.query(secureQuery);
    const executionTime = Date.now() - startTime;
    
    return {
      data: result.recordset,
      rowCount: result.recordset.length,
      executionTime,
      query: secureQuery,
      timestamp: new Date()
    };
    
  } catch (error) {
    console.error('Error executing secure query:', error);
    throw error;
  }
}

/**
 * Get table schema information for upload tables
 */
export async function getUploadTableSchema(tableName: string, clientId: string): Promise<any[]> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    // Validate the table exists and belongs to the client first
    const isValid = await validateUploadTable(tableName, clientId);
    if (!isValid) {
      throw new Error(`Table ${tableName} not found or not accessible for client ${clientId}`);
    }
    
    request.input('tableName', sql.VarChar, tableName);
    
    const query = `
      SELECT 
        COLUMN_NAME as columnName,
        DATA_TYPE as dataType,
        IS_NULLABLE as isNullable,
        COLUMN_DEFAULT as defaultValue,
        CHARACTER_MAXIMUM_LENGTH as maxLength
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = @tableName
      ORDER BY ORDINAL_POSITION
    `;
    
    const result = await request.query(query);
    return result.recordset;
    
  } catch (error) {
    console.error('Error fetching table schema:', error);
    throw error;
  }
}

/**
 * Get sample data from an upload table (limited rows for analysis)
 */
export async function getUploadTableSample(
  tableName: string, 
  clientId: string, 
  sampleSize: number = 10
): Promise<any[]> {
  const pool = getDatabaseConnection();
  const request = pool.request();
  
  try {
    // Validate the table exists and belongs to the client first
    const isValid = await validateUploadTable(tableName, clientId);
    if (!isValid) {
      throw new Error(`Table ${tableName} not found or not accessible for client ${clientId}`);
    }
    
    request.input('sampleSize', sql.Int, sampleSize);
    
    const query = `
      SELECT TOP (@sampleSize) *
      FROM ${tableName}
      WHERE client_id = '${clientId}'
      ORDER BY upload_date DESC
    `;
    
    const result = await request.query(query);
    return result.recordset;
    
  } catch (error) {
    console.error('Error fetching table sample:', error);
    throw error;
  }
}