"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "nexshop-frontend/script.js"), "utf8");

assert.doesNotMatch(index, /id=["']musicCoverImg["']/);
assert.doesNotMatch(index, /aida-public\//);
assert.doesNotMatch(script, /musicCoverImg/);
assert.doesNotMatch(script, /cover_url/);
assert.match(index, /script\.js\?v=20260827-black-vinyl/);
assert.match(index, /id=["']musicDisc["'][^>]*bg-\[#(?:111|0a0a0c|090a0b)\]/);
assert.match(index, /musicDisc[\s\S]*?(?:Grooves|groove|border-white\/5)/i);
assert.match(index, /id=["']musicPlayBtn["']/);
assert.match(script, /heroAudioPlayer\.src = audioUrl/);

console.log("sim43_music_player_black_first_paint: passed");
