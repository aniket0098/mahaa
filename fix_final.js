const fs = require('fs');
const p = 'c:\\mahaa\\src\\app\\(candidate)\\learn\\index.tsx';
let c = fs.readFileSync(p, 'utf8');
// Fix testID={\topic-chip-} where \t is literal backslash-t (not tab char)
c = c.replace(/testID={\\topic-chip-}/g, 'testID={`topic-chip-${chip.id}`}');
fs.writeFileSync(p, c, 'utf8');
console.log('Fix applied');
console.log('Remaining broken testID: ' + (c.includes('testID={\\topic-chip-}')));