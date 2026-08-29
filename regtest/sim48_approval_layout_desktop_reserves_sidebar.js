const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'nexshop-frontend', 'admin', 'css', 'style.css');
const htmlPath = path.join(__dirname, '..', 'nexshop-frontend', 'admin', 'dashboard.html');
const css = fs.readFileSync(cssPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Desktop sidebar is fixed and therefore removed from flex flow. The main
// column must reserve the sidebar width, while the mobile media query must
// release it again when the drawer overlays the page.
assert(/\.app-shell\s*>\s*main\s*\{[^}]*margin-left\s*:\s*260px/s.test(css),
    'desktop app-shell main must reserve the 260px fixed sidebar');
assert(/\.app-shell\s*>\s*main\s*\{[^}]*width\s*:\s*calc\(100%\s*-\s*260px\)/s.test(css),
    'desktop app-shell main width must exclude the fixed sidebar');
assert(/@media\s*\(max-width\s*:\s*991px\)[\s\S]*?\.app-shell\s*>\s*main\s*\{[^}]*margin-left\s*:\s*0/s.test(css),
    'mobile app-shell main must remove desktop sidebar offset');
assert(/css\/style\.css\?v=20260829-visual-regression-1/.test(html),
    'dashboard must bump the CSS cache-buster for the approval layout fix');

console.log('PASS sim48: desktop Approval Staff layout reserves sidebar and mobile releases it');
