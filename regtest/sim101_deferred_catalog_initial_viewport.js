"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../nexshop-frontend/script.js"), "utf8");
const match = source.match(/function loadSectionWhenNear\(selector, loader\) \{[\s\S]*?\n\}/);
assert.ok(match, "loadSectionWhenNear must exist");

const section = {
    getBoundingClientRect: () => ({ top: 96, bottom: 420, height: 324 })
};
let loaderCalls = 0;
let disconnected = false;
class SilentIntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() { disconnected = true; }
}

const context = {
    document: { querySelector: (selector) => selector === "#topup" ? section : null },
    window: {
        innerHeight: 844,
        IntersectionObserver: SilentIntersectionObserver,
        addEventListener: () => {},
        removeEventListener: () => {}
    },
    IntersectionObserver: SilentIntersectionObserver,
    runBackgroundTask: (task) => Promise.resolve().then(task),
    console: { error() {} }
};
vm.createContext(context);
vm.runInContext(`${match[0]}\nthis.loadSectionWhenNear = loadSectionWhenNear;`, context);
context.loadSectionWhenNear("#topup", () => { loaderCalls += 1; });

setImmediate(() => {
    assert.equal(loaderCalls, 1, "a section already inside the initial viewport must start loading even if observer delivery is delayed");
    assert.equal(disconnected, true, "observer should be disconnected after the immediate fallback starts");
    console.log("sim101_deferred_catalog_initial_viewport: passed");
});
