const fs = require('fs');
const p = 'c:\\mahaa\\src\\app\\(candidate)\\learn\\index.tsx';
let c = fs.readFileSync(p, 'utf8');
// Fix backslash-escaped quotes: \" -> "
c = c.replace(/\\\\\"/g, '\\"');
fs.writeFileSync(p, c, 'utf8');
console.log('Fix 1 done: backslash-escaped quotes removed');