"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../nexshop-frontend/script.js"), "utf8");
const match = source.match(/function loadSectionWhenNear\(selector, loader\) \{[\s\S]*?\n\}/);
assert.ok(match, "loadSectionWhenNear must exist");

let sectionTop = 2200;
const listeners = {};
let loaderCalls = 0;
class SilentIntersectionObserver {
    observe() {}
    disconnect() {}
}
const windowStub = {
    innerHeight: 768,
    IntersectionObserver: SilentIntersectionObserver,
    addEventListener: (type, handler) => { listeners[type] = handler; },
    removeEventListener: (type, handler) => { if (listeners[type] === handler) delete listeners[type]; }
};
const context = {
    document: { querySelector: () => ({ getBoundingClientRect: () => ({ top: sectionTop, bottom: sectionTop + 300 }) }) },
    window: windowStub,
    IntersectionObserver: SilentIntersectionObserver,
    runBackgroundTask: (task) => Promise.resolve().then(task),
    console: { error() {} }
};
vm.createContext(context);
vm.runInContext(`${match[0]}\nthis.loadSectionWhenNear = loadSectionWhenNear;`, context);
context.loadSectionWhenNear("#topup", () => { loaderCalls += 1; });
assert.equal(loaderCalls, 0, "a far section must remain lazy");
assert.equal(typeof listeners.scroll, "function", "a silent observer needs a passive scroll fallback");
sectionTop = 120;
listeners.scroll();
setImmediate(() => {
    assert.equal(loaderCalls, 1, "scrolling a section into the viewport must start the catalog if observer delivery is unavailable");
    assert.equal(listeners.scroll, undefined, "scroll fallback must be removed after the one-time loader starts");
    console.log("sim102_deferred_catalog_scroll_fallback: passed");
});
