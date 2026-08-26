const fs = require("fs/promises");
const path = require("path");

function normalizeApiKey(value) {
    const key = String(value || "").trim();
    if (key.length < 24 || key.length > 512) {
        throw new Error("WA API key harus antara 24 dan 512 karakter.");
    }
    return key;
}

/**
 * Menyimpan key gateway di volume data VPS, bukan di source code atau .env.
 * File ditulis atomik supaya restart/power loss tidak menyisakan JSON korup.
 */
function createRuntimeConfigStore({ configPath }) {
    const resolvedPath = path.resolve(configPath);
    let apiKey = "";

    async function load() {
        try {
            const raw = await fs.readFile(resolvedPath, "utf8");
            const parsed = JSON.parse(raw);
            apiKey = parsed?.apiKey ? normalizeApiKey(parsed.apiKey) : "";
        } catch (error) {
            if (error.code === "ENOENT") {
                apiKey = "";
                return;
            }
            throw new Error(`Gagal membaca konfigurasi runtime WA gateway: ${error.message}`);
        }
    }

    async function setApiKey(value) {
        const nextKey = normalizeApiKey(value);
        const parentDir = path.dirname(resolvedPath);
        const tempPath = `${resolvedPath}.${process.pid}.${Date.now()}.tmp`;
        await fs.mkdir(parentDir, { recursive: true, mode: 0o700 });
        try {
            await fs.writeFile(tempPath, `${JSON.stringify({ apiKey: nextKey }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
            await fs.rename(tempPath, resolvedPath);
            apiKey = nextKey;
        } finally {
            await fs.rm(tempPath, { force: true }).catch(() => {});
        }
    }

    return {
        load,
        setApiKey,
        getApiKey: () => apiKey,
        getConfigPath: () => resolvedPath
    };
}

module.exports = { createRuntimeConfigStore, normalizeApiKey };
