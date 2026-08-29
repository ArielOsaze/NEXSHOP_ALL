"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "nexshop-frontend/index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "nexshop-frontend/script.js"), "utf8");
const style = fs.readFileSync(path.join(root, "nexshop-frontend/style.css"), "utf8");

assert.match(index, /id=["']musicCoverImg["'][^>]*src=["']["']/);
assert.match(script, /const coverUrl = typeof data\.music\.cover_url === "string"/);
assert.match(script, /musicCoverImg\.src\s*=\s*coverUrl/);
assert.doesNotMatch(script, /coverUrl\s*=\s*data\.music\.cover_url\s*\|\|/);
assert.match(index, /class="[^"]*music-cover-image[^"]*"/);
assert.match(style, /\.music-cover-image\s*\{[\s\S]*?opacity:\s*0/);
assert.match(style, /\.music-cover-image\.is-loaded\s*\{[\s\S]*?opacity:\s*1/);
assert.match(index, /style\.css\?v=20260828-progressive-products-1/);
assert.match(index, /script\.js\?v=20260829-visual-regression-1/);
assert.match(index, /class="[^"]*music-disc-shell[^"]*"/);
assert.match(style, /\.music-disc-shell\s*\{[\s\S]*?background:/);
assert.match(style, /\.music-disc-shell\s*\{[\s\S]*?border:/);
assert.match(index, /id=["']musicPlayBtn["']/);
assert.match(script, /heroAudioPlayer\.src = audioUrl/);

console.log("sim43_music_player_black_first_paint: passed");
