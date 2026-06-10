import pg from 'pg';

/**
 * Neon PostgreSQL Connection Example
 * 
 * Neon is a serverless PostgreSQL database designed for developer productivity.
 * Because Neon requires encrypted connections, your connection string MUST include 
 * the SSL query parameter (e.g., `?sslmode=require`).
 * 
 * This module demonstrates:
 * 1. Initializing a connection pool using standard 'pg'.
 * 2. Executing a safe SELECT NOW() statement to verify connection and query latency.
 * 3. Gracefully draining the connection pool.
 */

// Load the connection string from environment variables or use a standard structure template
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://username:password@ep-cool-cloud-123456.us-east-2.aws.neon.tech/neondb?sslmode=require';

/**
 * Connects to Neon PostgreSQL using standard node-postgres (pg) connection pooling.
 * This is the recommended approach for standard Node.js server environments (e.g. Express APIs).
 * 
 * @returns {Promise<boolean>} Success state of the connection
 */
export async function connectWithPgPool() {
  console.log('\n=========================================');
  console.log('⚡ Neon PostgreSQL: Testing standard connection pool...');
  console.log('=========================================');

  const { Pool } = pg;
  
  // Initialize connection pool
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      // Neon requires SSL. rejectUnauthorized: false is common for local development testing,
      // but in production, you can configure standard SSL certificates.
      rejectUnauthorized: false
    }
  });

  try {
    const start = Date.now();
    console.log('🔄 Connecting to Neon Database...');
    
    // Acquire a client from the pool to test immediately
    const client = await pool.connect();
    console.log('🟢 Client successfully checked out from pool.');

    console.log('🛰️  Executing active query: SELECT NOW();');
    const result = await client.query('SELECT NOW() as current_time, version();');
    const duration = Date.now() - start;

    console.log(`🎉 Query executed successfully in ${duration}ms!`);
    console.log('📊 Database Response:');
    console.log(`   - Server Time:      ${result.rows[0].current_time}`);
    console.log(`   - PostgreSQL Ver:   ${result.rows[0].version.split(',')[0]}`);

    // Release the client back to the pool
    client.release();
    console.log('🟢 Client released back to pool.');
    
    // Shut down the pool (closes all active connections in the pool)
    await pool.end();
    console.log('🔌 Pool closed cleanly.');
    return true;

  } catch (error) {
    console.error('❌ Neon PostgreSQL connection or query failed!');
    console.error('🚨 Error Message:', error.message);
    console.log('\n💡 Tip: Verify your DATABASE_URL in the .env file.');
    console.log('   Make sure you appended `?sslmode=require` to enable secure SSL connections.');
    return false;
  }
}

/**
 * Alternative: Neon Serverless SQL Driver
 * 
 * If you are running in an Edge environment (like Vercel Edge Functions or Cloudflare Workers)
 * where TCP connections are restricted, Neon recommends using `@neondatabase/serverless`.
 * 
 * Code structure example:
 * 
 * import { neon } from '@neondatabase/serverless';
 * 
 * export async function connectWithNeonServerless() {
 *   const sql = neon(process.env.DATABASE_URL);
 *   const response = await sql`SELECT NOW()`;
 *   return response[0].now;
 * }
 */
