const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

const dashboardHtml = read("nexshop-frontend/admin/dashboard.html");
const editorialJs = read("nexshop-frontend/admin/js/editorial.js");
const articleHtml = read("nexshop-frontend/berita-artikel.html");
const newsController = read("nexshop-backend/controllers/newsArticleController.js");
const uploadRoutes = read("nexshop-backend/routes/uploadRoutes.js");

assert(/id="editInlineImageFile"[^>]*type="file"/.test(dashboardHtml), "News editor must provide a dedicated inline image file input");
assert(/id="editInlineImagePosition"/.test(dashboardHtml), "News editor must provide an explicit inline image position selector");
assert(/id="editInlineImageAlt"/.test(dashboardHtml), "Inline image must provide alt text input");
assert(/id="editInlineImageCaption"/.test(dashboardHtml), "Inline image must provide optional caption input");
assert(/id="editInlineImageUploadBtn"/.test(dashboardHtml), "News editor must provide an inline image insertion button");
assert(/refreshInlineImagePositions/.test(editorialJs), "Editor must derive selectable positions from article blocks");
assert(/insertInlineImageAtPosition/.test(editorialJs), "Editor must insert the image at the selected article position");
assert(/\/upload\/image\?type=product/.test(editorialJs), "Inline image upload must use the protected existing image upload endpoint");
assert(/new FormData\(\)/.test(editorialJs), "Inline image upload must use multipart FormData");
assert(/article-inline-image/.test(editorialJs), "Inline image must be stored as a dedicated figure block");
assert(/\.article-body \.article-inline-image\s*\{[^}]*text-align:\s*left/.test(articleHtml), "Inline image block must align with article text");
assert(/\.article-body \.article-inline-image img\s*\{[^}]*margin:\s*0;/.test(articleHtml), "Inline image must not be auto-centered");
assert(/articleImageUrls/.test(articleHtml), "Public SEO must collect hero and inline image URLs");
assert(/\.article-body \.article-inline-image img[\s\S]*?width:\s*auto[\s\S]*?max-width:\s*100%[\s\S]*?height:\s*auto/.test(articleHtml), "Inline image must preserve uploaded aspect ratio without forced frame sizing");
assert(!/\.article-body \.article-inline-image img[\s\S]*?object-fit:\s*contain/.test(articleHtml), "Inline image must not letterbox uploaded photos inside a forced box");
assert(/startsWith\(["']\/["']\)/.test(articleHtml), "SEO image collection must normalize legacy root-relative image URLs");
assert(/figure/.test(newsController) && /img/.test(newsController), "Backend sanitizer must preserve figure and img content blocks");
assert(/router\.post\("\/image"/.test(uploadRoutes), "Protected image upload route must remain available");
assert(/loading/.test(editorialJs), "Inline images must use lazy loading");

console.log("PASS sim89: News editor supports selectable-position inline image insertion and safe public rendering contract");
