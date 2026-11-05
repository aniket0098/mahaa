const fs = require('fs');
const p = 'c:\\mahaa\\src\\app\\(candidate)\\learn\\index.tsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/testID={\\topic-chip-}/g, 'testID={`topic-chip-${chip.id}`}');
c = c.replace(/testID={\\topic-chip-/g, 'testID={`topic-chip-${chip.id}`}');
fs.writeFileSync(p, c, 'utf8');
console.log('Fix 3 done: testID fixed');