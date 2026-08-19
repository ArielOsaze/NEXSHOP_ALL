const fs = require('fs');
const code = fs.readFileSync('nexshop-frontend/script.js', 'utf8');
const lines = code.split('\n');

let btCount = 0;
let lastBtLine = -1;
for (let i = 0; i < lines.length; i++) {
    for (let c of lines[i]) {
        if (c === '`') {
            btCount++;
            lastBtLine = i + 1;
        }
    }
}
console.log('Total backticks:', btCount);
console.log('Last backtick on line:', lastBtLine);
