import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectWithPgPool } from './neonPostgres.js';
import { testRedisConnection } from './redisClient.js';

// Resolve directory name in ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom light-weight .env parser
 * Node.js 20.12.0+ supports process.loadEnvFile(), but to be fully backward-compatible 
 * with all Node versions, we use a simple parser to load root-level .env variables.
 */
function loadDotenv() {
  const rootEnvPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(rootEnvPath)) {
    console.log(`📁 Found .env file at root: ${rootEnvPath}`);
    const envContent = fs.readFileSync(rootEnvPath, 'utf-8');
    
    envContent.split(/\r?\n/).forEach(line => {
      // Remove comments and trim whitespace
      const cleanedLine = line.split('#')[0].trim();
      if (!cleanedLine) return;
      
      const parts = cleanedLine.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        // Join back parts in case the value itself contained "=" (like connection strings)
        const value = parts.slice(1).join('=').trim();
        
        // Remove surrounding quotes if present
        const cleanedValue = value.replace(/^['"]|['"]$/g, '');
        
        if (key && !process.env[key]) {
          process.env[key] = cleanedValue;
        }
      }
    });
    console.log('✅ Environment variables successfully populated from .env.');
  } else {
    console.log('⚠️  No .env file found at root. Using default fallback configuration strings.');
  }
}

// Initialize environment configuration
loadDotenv();

/**
 * Runs connection test sequences for both Neon PostgreSQL and Redis.
 */
async function executeConnections() {
  console.log('\n======================================================');
  console.log('🚀 ACTIVE TRACK: DUMMY CONNECTION TESTER STARTING');
  console.log('======================================================');
  
  // Safe display of connection variables
  const dbUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  
  console.log(`📡 Neon PostgreSQL Status: ${dbUrl ? '✅ Configured (Masked Link)' : '⚠️ Unconfigured'}`);
  console.log(`📡 Redis Server Status:     ${redisUrl ? '✅ Configured (Masked Link)' : '⚠️ Unconfigured'}`);
  
  // Run Neon PostgreSQL connection test
  const pgResult = await connectWithPgPool();
  
  // Run Redis connection test
  const redisResult = await testRedisConnection();
  
  console.log('\n======================================================');
  console.log('📊 DUMMY PIPELINE RUN SUMMARY');
  console.log('======================================================');
  console.log(`- Neon PostgreSQL Client Pool Connection: ${pgResult ? '🟢 SUCCESS' : '🔴 FAILED'}`);
  console.log(`- Redis Server Key-Value & Expiry Ops:     ${redisResult ? '🟢 SUCCESS' : '🔴 FAILED'}`);
  console.log('======================================================\n');
}

executeConnections().catch((error) => {
  console.error('💥 Execution halted due to an unexpected runner error:', error);
});
