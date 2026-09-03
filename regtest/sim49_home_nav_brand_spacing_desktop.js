const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'nexshop-frontend', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'nexshop-frontend', 'index.html'), 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// On wide screens the public desktop nav must keep visible breathing room
// between the logo lockup and the link cluster instead of relying only on a
// tiny utility gap from the HTML.
assert(/@media\s*\(min-width\s*:\s*1536px\)[\s\S]*?#mainNav\s+\.nx-brand-lockup\s*\{[^}]*gap\s*:\s*0\.75rem/s.test(css),
    'desktop main nav brand needs an explicit 0.75rem logo/text gap');
assert(/@media\s*\(min-width\s*:\s*1536px\)[\s\S]*?#mainNav\s+\.nx-main-nav-desktop\s*\{[^}]*margin-left\s*:/s.test(css),
    'desktop main nav needs explicit separation between brand and links');
assert(/style\.css\?v=20260903-responsive-nav-account-5/.test(html),
    'homepage must bump the shared CSS cache-buster for navbar spacing');

console.log('PASS sim49: desktop homepage navbar keeps readable brand spacing');
