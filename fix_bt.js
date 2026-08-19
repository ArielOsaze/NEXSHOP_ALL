const fs = require('fs');
let code = fs.readFileSync('nexshop-frontend/script.js', 'utf8');
// We want to replace \` with `
code = code.replace(/\\`/g, '`');
fs.writeFileSync('nexshop-frontend/script.js', code);
console.log('Fixed backticks');
