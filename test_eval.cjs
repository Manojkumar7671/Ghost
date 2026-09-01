const vm = require('vm');
const s = new Set();
try { s.remove('x'); } catch(e) { console.log(e.message); }
