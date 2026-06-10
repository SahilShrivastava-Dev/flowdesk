import Redis from 'ioredis';

/**
 * Redis Connection & Operations Example
 * 
 * Redis is utilized in ActiveTrack to manage heavy database queue operations (e.g. BullMQ).
 * This module demonstrates:
 * 1. Initializing an ioredis client with customizable connection timeouts and retries.
 * 2. Logging client lifecycle event listeners (connect, ready, error, close).
 * 3. Performing atomic operations (SET, GET, DEL) using JSON payloads and key expiration (TTL).
 * 4. Gracefully quitting the Redis client.
 */

// Load the Redis URL from environment variables or fallback to standard localhost Redis
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

/**
 * Connects to Redis and executes dummy operations to verify integrity.
 * 
 * @returns {Promise<boolean>} Success state of Redis operations
 */
export async function testRedisConnection() {
  console.log('\n=========================================');
  console.log('❤️  Redis: Testing client connection and operations...');
  console.log('=========================================');

  console.log('🔄 Initializing Redis client...');
  
  // Create an ioredis instance
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    connectTimeout: 5000, // Fail fast if Redis is down
    lazyConnect: true // Prevent automatic immediate connection to handle connect manually
  });

  // Client Lifecycle Event Subscriptions
  redis.on('connect', () => {
    console.log('🟢 Redis: Client started connecting to server...');
  });

  redis.on('ready', () => {
    console.log('✅ Redis: Connection is fully established and ready for commands.');
  });

  redis.on('error', (error) => {
    console.error('❌ Redis: Encountered an error:', error.message);
  });

  redis.on('end', () => {
    console.log('🔌 Redis: Connection closed.');
  });

  try {
    // Manually trigger the connection
    await redis.connect();

    const testKey = 'activetrack:dummy_key';
    const testValue = JSON.stringify({
      status: 'success',
      timestamp: new Date().toISOString(),
      developerNote: 'ActiveTrack queue pipeline check',
      scope: 'Dummy Test Code'
    });

    console.log(`💾 Command: SET "${testKey}" with 60s expiration...`);
    // 'EX' sets an expiration time in seconds (Time to Live)
    await redis.set(testKey, testValue, 'EX', 60);
    console.log('🟢 Key stored successfully.');

    console.log(`🔍 Command: GET "${testKey}"...`);
    const result = await redis.get(testKey);
    
    if (result) {
      console.log('🎉 Data successfully retrieved:');
      console.log(JSON.stringify(JSON.parse(result), null, 2));
    } else {
      throw new Error('Key was not set correctly or expired instantly.');
    }

    console.log(`🧹 Command: DEL "${testKey}"...`);
    await redis.del(testKey);
    console.log('🟢 Cleanup complete.');

    // Gracefully disconnect
    console.log('🔌 Disconnecting from Redis...');
    await redis.quit();
    return true;

  } catch (error) {
    console.error('❌ Redis verification failed!');
    console.error('🚨 Error Message:', error.message);
    console.log('\n💡 Tip: Verify your REDIS_URL matches your local instance or cloud Redis.');
    console.log('   Ensure your Redis server is running: `redis-server` (local) or your cloud password is correct.');
    
    // Fallback cleanup to prevent hanging threads if initialization succeeded but ops failed
    try {
      redis.disconnect();
    } catch (_) {}
    
    return false;
  }
}
