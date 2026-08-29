"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "nexshop-frontend", "script.js"), "utf8");
const index = fs.readFileSync(path.join(root, "nexshop-frontend", "index.html"), "utf8");

assert(index.includes('id="homeProductLoadMoreZone"'), "zone progres produk utama harus ada di bawah grid");
assert(script.includes("const HOME_PRODUCT_BATCH_SIZE = 20"), "batch awal harus dibatasi 20 kartu");
assert(script.includes("let visibleHomeProductCount = 0"), "state jumlah kartu yang terlihat harus eksplisit");
assert(script.includes("function loadMoreHomeProducts()"), "harus ada loader batch produk berikutnya");
assert(script.includes("function setupHomeProductObserver()"), "lazy observer produk utama harus tersedia");
assert(script.includes('rootMargin: "700px"'), "observer harus prefetch sebelum user mencapai akhir kartu");
assert(script.includes("homeProductLoadMoreZone"), "progress zone harus dirender dan diperbarui");
assert(script.includes("homeProductLoadMoreBtn"), "fallback tombol load more harus keyboard-accessible");
assert(script.includes("Menampilkan ${visibleHomeProductCount} dari ${activeHomeProducts.length} Produk"), "progress harus menjelaskan katalog parsial secara eksplisit");
assert(script.includes("${remaining} produk lainnya tersedia"), "jumlah produk tersisa harus terlihat");
assert(script.includes("grid.insertAdjacentHTML(\"beforeend\", nextBatch.map(renderHomeProductCard).join(\"\"))"), "batch berikutnya harus append, bukan render ulang seluruh kartu");
assert(script.includes("visibleHomeProductCount = Math.min(HOME_PRODUCT_BATCH_SIZE, activeHomeProducts.length)"), "search/filter harus reset ke batch awal yang terukur");

assert(index.includes('style.css?v=20260828-progressive-products-1'), "CSS katalog baru wajib memakai cache-buster baru");
assert(index.includes('script.js?v=20260829-visual-regression-1'), "renderer katalog baru wajib memakai cache-buster baru");

console.log("PASS sim59: katalog utama progressive, lengkap, dan discoverable");
