"use strict";

const fs = require("fs");
const path = require("path");

function getKnownChromeExecutables() {
    const builtIn = process.platform === "win32" ? [
        path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe")
    ] : process.platform === "darwin" ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ] : [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium"
    ];
    const extra = String(process.env.ALLOWED_CHROME_EXECUTABLE_PATHS || "")
        .split(path.delimiter)
        .map((value) => value.trim())
        .filter(Boolean);
    return [...new Set([...builtIn, ...extra].map((value) => path.resolve(value)))];
}

function normalizeExecutablePath(value) {
    const candidate = path.resolve(String(value || "").trim());
    try {
        return fs.realpathSync(candidate);
    } catch (_) {
        return candidate;
    }
}

function isAllowedChromeExecutable(value) {
    const candidate = normalizeExecutablePath(value);
    const insensitive = process.platform === "win32";
    return getKnownChromeExecutables().some((known) => {
        const normalizedKnown = normalizeExecutablePath(known);
        return insensitive
            ? normalizedKnown.toLowerCase() === candidate.toLowerCase()
            : normalizedKnown === candidate;
    });
}

module.exports = { getKnownChromeExecutables, isAllowedChromeExecutable };
