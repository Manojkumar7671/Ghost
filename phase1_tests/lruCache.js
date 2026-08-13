class LRUCache {
    constructor(capacity) {
        this.capacity = capacity;
        this.cache = new Map();
    }

    get(key) {
        if (this.cache.has(key)) {
            const value = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, value);
            return value;
        }
        return -1;
    }

    put(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size === this.capacity) {
            this.cache.delete(this.cache.keys().next().value);
        }
        this.cache.set(key, value);
    }
}

const cache = new LRUCache(2);

console.log(cache.put(1, 1));  // 1
console.log(cache.put(2, 2));  // 2
console.log(cache.get(1));  // 1
console.log(cache.put(3, 3));  // 1
console.log(cache.get(2));  // -1