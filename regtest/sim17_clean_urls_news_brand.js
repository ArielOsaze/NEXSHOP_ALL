"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

let failed = 0;
let total = 0;
function check(name, condition) {
    total += 1;
    const ok = Boolean(condition);
    if (!ok) failed += 1;
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}`);
}

console.log("NEXSHOP REGTEST 17: CLEAN URL & BRANDING BERITA\n");

const nginx = read("nginx-nexshop.conf").replace(/\r\n/g, "\n");
const publicRoutes = ["berita", "marketplace", "reseller", "portal-reseller", "docs-reseller", "login"];

check(
    "seluruh halaman publik memiliki redirect permanen dari .html",
    publicRoutes.every((route) => nginx.includes(`location = /${route}.html { return 301 /${route}`))
);
check(
    "seluruh URL bersih dilayani tanpa redirect internal kembali ke .html",
    publicRoutes.every((route) => nginx.includes(`location = /${route} { rewrite ^ /${route}.html break; }`)
        || nginx.includes(`location = /${route} {\n        rewrite ^ /${route}.html break;`)
        || nginx.includes(`location = /${route} {\n        expires -1;\n        rewrite ^ /${route}.html break;`))
);
check(
    "login dan dashboard admin juga memiliki URL tanpa ekstensi",
    nginx.includes("location = /admin/login.html { return 301 /admin/login")
        && nginx.includes("location = /admin/dashboard.html { return 301 /admin/dashboard")
);
check(
    "artikel legacy diarahkan ke URL /berita/:slug",
    nginx.includes("location = /berita-artikel.html { return 301 /berita/$arg_slug; }")
);

const publicFiles = [
    "nexshop-frontend/berita.html",
    "nexshop-frontend/berita-artikel.html",
    "nexshop-frontend/docs-reseller.html",
    "nexshop-frontend/login.html",
    "nexshop-frontend/marketplace.html",
    "nexshop-frontend/portal-reseller.html",
    "nexshop-frontend/reseller.html"
];
const publicMarkup = publicFiles.map(read).join("\n");
check(
    "link navigasi publik tidak lagi memakai href .html",
    !/href=["'][^"']*\.html(?:[?#"'])/i.test(publicMarkup)
);
check(
    "canonical Partner Portal memakai URL bersih",
    read("nexshop-frontend/portal-reseller.html").includes('rel="canonical" href="https://nexshop.cloud/portal-reseller"')
);
const walletController = read("nexshop-backend/controllers/walletController.js");
check(
    "return URL gateway Wallet kembali ke Marketplace tanpa .html",
    walletController.includes("${FRONTEND_URL}/marketplace?topup=${topupId}&status=success")
        && !walletController.includes("/marketplace.html?topup=")
);
check(
    "tautan kartu berita memakai /berita/:slug",
    read("nexshop-frontend/berita.html").includes("return `/berita/${encodeURIComponent(slug)}`")
        && read("nexshop-frontend/admin/js/editorial.js").includes('href="/berita/${encodeURIComponent(art.slug)}"')
);

const newsList = read("nexshop-frontend/berita.html");
const newsArticle = read("nexshop-frontend/berita-artikel.html");
check(
    "badge kategori pada daftar dan artikel memakai cyan",
    (newsList.match(/color: var\(--cyan\);/g) || []).length >= 2
        && newsArticle.includes(".article-cat-badge")
        && newsArticle.includes("color: var(--cyan);")
        && !newsArticle.includes("rgba(216, 180, 254, 0.95)")
);
check(
    "tag chip dan kategori artikel terkait tidak lagi ungu",
    newsArticle.includes(".tag-chip:hover { border-color: var(--cyan); color: var(--cyan); }")
        && newsArticle.includes(".related-cat")
        && /\.related-cat[^\n]+color: var\(--cyan\)/.test(newsArticle)
);

console.log(`\nRINGKASAN: ${failed ? `${failed} dari ${total} pengujian gagal` : `${total}/${total} pengujian lolos`}.`);
if (failed) process.exitCode = 1;
