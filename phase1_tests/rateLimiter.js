class RateLimiter {
  constructor() {
    this.userIdWindows = {};
  }

  isAllowed(userId) {
    if (!this.userIdWindows[userId]) {
      this.userIdWindows[userId] = [];
    }

    const now = Date.now();
    this.userIdWindows[userId] = this.userIdWindows[userId].filter(timestamp => timestamp >= now - 10000);
    if (this.userIdWindows[userId].length < 5) {
      this.userIdWindows[userId].push(now);
      return true;
    }
    return false;
  }
}

const rateLimiter = new RateLimiter();

console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // true
console.log(rateLimiter.isAllowed("user1")); // false