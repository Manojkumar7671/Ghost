// Sliding window rate limiter implementation
// isAllowed(userId) returns true/false, max 5 requests per 10-second window per user
// No external dependencies
const rateLimiter = {
  userId: null,
  windowStart: 0,
  maxRequests: 5,
  windowSizeMs: 10000
};

function isAllowed(userId) {
  if (userId !== rateLimiter.userId) {
    rateLimiter.userId = userId;
    rateLimiter.windowStart = Date.now();
  }
  const currentTime = Date.now();
  if (currentTime - rateLimiter.windowStart > rateLimiter.windowSizeMs) {
    rateLimiter.windowStart = currentTime;
  }
  return rateLimiter.userId === userId && rateLimiter.maxRequests > 0;
}

// Self-test at the bottom
const userId = 'test-user';
for (let i = 0; i < 7; i++) {
  const allowed = isAllowed(userId);
  console.log(`Call ${i+1}: Allowed=${allowed}`);
  if (allowed) {
    rateLimiter.maxRequests--;
  }
}
