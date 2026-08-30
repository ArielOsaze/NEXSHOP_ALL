const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const dashboardHtml = fs.readFileSync(path.join(root, "nexshop-frontend", "admin", "dashboard.html"), "utf8");
const editorialJs = fs.readFileSync(path.join(root, "nexshop-frontend", "admin", "js", "editorial.js"), "utf8");
const uploadRoutes = fs.readFileSync(path.join(root, "nexshop-backend", "routes", "uploadRoutes.js"), "utf8");

assert(/id="editImageUrl"[^>]*type="url"/.test(dashboardHtml), "News must keep HTTPS image URL option");
assert(/id="editImageFile"[^>]*type="file"/.test(dashboardHtml), "News must provide an image file input");
assert(/id="editImageUploadBtn"/.test(dashboardHtml), "News must provide an upload button");
assert(/accept="image\/(jpeg|png)/.test(dashboardHtml), "News upload must restrict image MIME types");
assert(/new FormData\(\)/.test(editorialJs), "News upload must use multipart FormData");
assert(/\/upload\/image\?type=product/.test(editorialJs), "News upload must use the protected image upload endpoint");
assert(/const urlInput = document\.getElementById\("editImageUrl"\)/.test(editorialJs) && /urlInput\.value = json\.url/.test(editorialJs), "Uploaded URL must populate the article image URL");
assert(/options\.body instanceof FormData/.test(editorialJs), "API wrapper must not force JSON Content-Type for file uploads");
assert(/router\.post\("\/image"/.test(uploadRoutes), "Backend image upload route must exist");

console.log("PASS sim83: NexShop News supports URL or admin image upload");
