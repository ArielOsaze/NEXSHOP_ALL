const fs = require('fs');
const code = fs.readFileSync('nexshop-frontend/script.js', 'utf8');

let btCount = 0;
let lastBtLine = -1;
let openLine = -1;

const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines[i].length; j++) {
        // Handle escaped backticks
        if (lines[i][j] === '\\' && lines[i][j+1] === '`') {
            j++; continue;
        }
        if (lines[i][j] === '`') {
            btCount++;
            if (btCount % 2 === 1) {
                openLine = i + 1;
            } else {
                openLine = -1;
            }
        }
    }
}
console.log('Unclosed backtick on line:', openLine);
