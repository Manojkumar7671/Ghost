const { AsyncLocalStorage } = require('async_hooks');
const traceLocalStorage = new AsyncLocalStorage();
module.exports = traceLocalStorage;
