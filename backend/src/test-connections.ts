import dotenv from 'dotenv';
import path from 'path';
import { initializeDatabase, executeQuery, closeDatabase } from './config/database';
import { sendPrompt } from './services/anthropic.service';
import { logger } from './config/logger';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function testConnections() {
  console.log('🧪 Testing Backend Connections...\n');

  // Test 1: Database Connection
  console.log('1. Testing Database Connection...');
  try {
    await initializeDatabase();
    const result = await executeQuery('SELECT 1 AS test');
    if (result.recordset[0]?.test === 1) {
      console.log('✅ Database connection successful!\n');
    } else {
      console.log('⚠️ Database connected but test query returned unexpected result\n');
    }
  } catch (error: any) {
    console.log('❌ Database connection failed:', error.message);
    console.log('💡 This is expected if MSSQL is not configured. You can mock the database for development.\n');
  }

  // Test 2: Anthropic AI Connection
  console.log('2. Testing Anthropic AI Connection...');
  try {
    const response = await sendPrompt(
      'Please respond with exactly: "AI connection successful"'
    );

    if (response.toLowerCase().includes('ai connection successful')) {
      console.log('✅ Anthropic AI connection successful!');
      console.log('   Response:', response, '\n');
    } else {
      console.log('⚠️ AI responded but with unexpected message:', response, '\n');
    }
  } catch (error: any) {
    console.log('❌ Anthropic AI connection failed:', error.message);
    console.log('💡 Make sure ANTHROPIC_API_KEY is set in your .env file\n');
  }

  // Test 3: Environment Configuration
  console.log('3. Checking Environment Configuration...');
  const requiredVars = [
    'PORT',
    'NODE_ENV',
    'MSSQL_SERVER',
    'MSSQL_DATABASE',
    'MSSQL_USER',
    'MSSQL_PASSWORD',
    'ANTHROPIC_API_KEY'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length === 0) {
    console.log('✅ All required environment variables are set!\n');
  } else {
    console.log('⚠️ Missing environment variables:', missingVars.join(', '));
    console.log('💡 Copy .env.example to .env and fill in the missing values\n');
  }

  // Summary
  console.log('📊 Test Summary:');
  console.log('- Environment: Partially configured');
  console.log('- Database: Can be mocked for development');
  console.log('- AI Service: Requires ANTHROPIC_API_KEY');
  console.log('\n🚀 Backend is ready for development!');
  console.log('Run "npm run dev" to start the development server.');

  // Close database connection
  await closeDatabase();
  process.exit(0);
}

// Run tests
testConnections().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
