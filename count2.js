const fs = require('fs');
const lines = fs.readFileSync('nexshop-frontend/script.js', 'utf8').split('\n');
let bt = 0;
for(let i=0; i<4335; i++) {
    for(let j=0; j<lines[i].length; j++) {
        if(lines[i][j] === '`') bt++;
    }
}
console.log('Total backticks before line 4335 (index 4334):', bt);
