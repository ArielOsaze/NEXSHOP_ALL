const { _test } = require('../nexshop-backend/controllers/newsArticleController');
const { marked } = require('../nexshop-backend/node_modules/marked');

if (!_test) {
    console.error("❌ Controller doesn't export _test object.");
    process.exit(1);
}

const { sanitizeHtml, removeGeminiCitations } = _test;

function testPipeline(input) {
    const rawContent = input || "";
    // Note: The pipeline in controller does:
    // 1. htmlContent = marked.parse(rawContent)
    // 2. content = sanitizeHtml(htmlContent)
    const htmlContent = marked.parse(rawContent);
    return sanitizeHtml(htmlContent);
}

let allPass = true;

function assertIncludes(name, result, expectedStr) {
    if (result.includes(expectedStr)) {
        console.log(`✅ [PASS] ${name}`);
    } else {
        console.error(`❌ [FAIL] ${name}\nExpected to include: ${expectedStr}\nGot:\n${result}\n`);
        allPass = false;
    }
}

function assertNotIncludes(name, result, unexpectedStr) {
    if (!result.includes(unexpectedStr)) {
        console.log(`✅ [PASS] ${name}`);
    } else {
        console.error(`❌ [FAIL] ${name}\nExpected NOT to include: ${unexpectedStr}\nGot:\n${result}\n`);
        allPass = false;
    }
}

console.log("==========================================");
console.log("   Markdown & Sanitizer Regression Test   ");
console.log("==========================================\n");

// 1. Paragraph & Headings
const md1 = "# Judul 1\n## Judul 2\nIni adalah paragraf.";
const res1 = testPipeline(md1);
assertIncludes("Paragraph & Headings (H1)", res1, "<h1>Judul 1</h1>");
assertIncludes("Paragraph & Headings (H2)", res1, "<h2>Judul 2</h2>");
assertIncludes("Paragraph & Headings (p)", res1, "<p>Ini adalah paragraf.</p>");

// 2. Bold & List
const md2 = "**Tebal** dan *miring*\n- Item 1\n- Item 2";
const res2 = testPipeline(md2);
assertIncludes("Bold & List (strong)", res2, "<strong>Tebal</strong>");
assertIncludes("Bold & List (em)", res2, "<em>miring</em>");
assertIncludes("Bold & List (ul)", res2, "<ul>");
assertIncludes("Bold & List (li)", res2, "<li>Item 1</li>");

// 3. Table
const md3 = "| Kolom 1 | Kolom 2 |\n|---|---|\n| Data 1 | Data 2 |";
const res3 = testPipeline(md3);
assertIncludes("Table (wrapper)", res3, '<div class="table-responsive">');
assertIncludes("Table (table)", res3, "<table>");
assertIncludes("Table (thead)", res3, "<thead>");
assertIncludes("Table (th)", res3, "<th>Kolom 1</th>");
assertIncludes("Table (tbody)", res3, "<tbody>");
assertIncludes("Table (td)", res3, "<td>Data 1</td>");

// 4. Unicode & Special Characters
const md4 = "Harga 🥇 Juara Rp1.280.000.000 -> special text!";
const res4 = testPipeline(md4);
assertIncludes("Unicode", res4, "🥇");

// 5. XSS Test
const md5 = 'Hello <script>alert(1)</script> <a href="javascript:alert(1)">Click</a> <img src="x" onerror="alert(1)">';
const res5 = testPipeline(md5);
assertNotIncludes("XSS (script tag removed)", res5, "<script>");
assertNotIncludes("XSS (javascript href removed)", res5, "javascript:");
assertNotIncludes("XSS (onerror removed)", res5, "onerror");
assertIncludes("XSS (valid a tag remains but cleaned)", res5, "<a>Click</a>");

// 6. Citation Markers
const md6 = "Berita ini benar. 【cite】 【turn0search1】\nJuga ada \uE200cite123\uE201 disini.";
const res6 = testPipeline(md6);
assertNotIncludes("Citation (【cite】)", res6, "【cite】");
assertNotIncludes("Citation (【turn...】)", res6, "【turn0search1】");
assertNotIncludes("Citation (PUA)", res6, "\uE200cite");

console.log("\n==========================================");
if (allPass) {
    console.log("🎉 ALL TESTS PASSED!");
    process.exit(0);
} else {
    console.error("💥 SOME TESTS FAILED.");
    process.exit(1);
}
