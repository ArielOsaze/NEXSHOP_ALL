const fs = require('fs');
let code = fs.readFileSync('nexshop-frontend/script.js', 'utf8');

// Find the very first loadOneStopCatalog
const firstOneStop = code.indexOf('async function loadOneStopCatalog()');
if (firstOneStop === -1) {
    console.log("Could not find loadOneStopCatalog");
    process.exit(1);
}

// Find the original start of Route handling
const firstRoute = code.indexOf('// Route handling');
if (firstRoute === -1) {
    console.log("Could not find Route handling");
    process.exit(1);
}

// We know the file is good from 0 to 4261
// Let's find the first `async function initMusicPlayer()`
const initMusic = code.indexOf('async function initMusicPlayer()');

// Let's find the end of initMusicPlayer block
// It ends with:
//         console.error("Music init error:", e);
//     }
// }
const endOfInitMusicStr = 'console.error("Music init error:", e);\r\n    }\r\n}';
const endOfInitMusicStrLf = 'console.error("Music init error:", e);\n    }\n}';
let endOfInitMusic = code.indexOf(endOfInitMusicStr);
if (endOfInitMusic === -1) {
    endOfInitMusic = code.indexOf(endOfInitMusicStrLf);
}

if (endOfInitMusic === -1) {
    console.log("Could not find end of initMusicPlayer");
    process.exit(1);
}

// Extract the good part of the file (top of file up to end of initMusicPlayer)
let part1 = code.substring(0, endOfInitMusic + endOfInitMusicStr.length);

// Wait, since I replaced and duplicated, `initMusicPlayer` itself might be broken.
// But the original file was PERFECT up to `// Route handling` !
// Wait, the previous agent ADDED `loadOneStopCatalog` AFTER `initMusicPlayer` and BEFORE `// Route handling`? No, the previous agent just added it anywhere.

// Instead of parsing, let's just use `git checkout`!
// wait, if I use `git checkout`, I lose the previous agent's uncommitted changes.
// Is it possible the previous agent DID commit?
// "Changes not staged for commit: modified: nexshop-frontend/script.js" 
// The previous agent did not commit.

// Let's extract exactly the oneStop block from the CURRENT file.
let oneStopBlockEnd = code.lastIndexOf('});\n\n');
if (oneStopBlockEnd === -1) oneStopBlockEnd = code.length;

let oneStopBlock = code.substring(firstOneStop, oneStopBlockEnd);

// Let's build a clean file.
// We know `temp_debug4.js` (lines 0 to 4330) was good except it ended abruptly.
// Let's see what line 4330 was. It was `async function loadOneStopCatalog() {`.
// That means the file up to line 4329 is PERFECT!
// So let's take lines 0 to 4329.
const lines = code.split('\n');
let cleanTop = lines.slice(0, 4329).join('\n');

// And what about the One Stop code? We can extract it by taking the first occurrence of `loadOneStopCatalog` until the end of its `DOMContentLoaded` block.
// Let's find `loadOneStopCatalog` in the lines array.
let oneStopStartLine = lines.findIndex(l => l.includes('async function loadOneStopCatalog()'));
// Now find the end of the `DOMContentLoaded` block that has `loadOneStopCatalog();`
let oneStopEndLine = lines.length;
for(let i=oneStopStartLine; i<lines.length; i++) {
    if (lines[i].trim() === '});' && lines[i-1] && lines[i-1].includes('}')) {
        // likely the end of DOMContentLoaded
        oneStopEndLine = i + 1;
        break;
    }
}
let cleanBottom = lines.slice(oneStopStartLine, oneStopEndLine).join('\n');

fs.writeFileSync('nexshop-frontend/script.js', cleanTop + '\n\n' + cleanBottom + '\n');
console.log("Successfully rebuilt script.js");
