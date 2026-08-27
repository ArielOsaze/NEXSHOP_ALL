"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "nexshop-frontend", "clean-url.js"), "utf8");

function executeAt(pathname) {
    const navigations = [];
    const historyUrls = [];
    const window = {
        location: {
            pathname,
            search: "",
            hash: "",
            origin: "https://nexshop.cloud",
            replace(url) { navigations.push(url); }
        },
        history: {
            state: null,
            replaceState(_state, _title, url) { historyUrls.push(url); }
        }
    };
    const document = { querySelector() { return null; } };
    vm.runInNewContext(source, { window, document, URL, Object });
    return { navigations, historyUrls };
}

for (const cleanPath of ["/admin/login", "/admin/dashboard"]) {
    const result = executeAt(cleanPath);
    if (result.navigations.length !== 0) {
        throw new Error(`${cleanPath} must not navigate to its .html alias; Nginx redirects that alias back and creates a loop.`);
    }
}

for (const [filePath, cleanPath] of [["/admin/login.html", "/admin/login"], ["/admin/dashboard.html", "/admin/dashboard"]]) {
    const result = executeAt(filePath);
    if (result.historyUrls.at(-1) !== cleanPath || result.navigations.length !== 0) {
        throw new Error(`${filePath} must be normalized in-place to ${cleanPath} without a network navigation.`);
    }
}

console.log("sim46_admin_clean_url_no_navigation_loop: PASS");
