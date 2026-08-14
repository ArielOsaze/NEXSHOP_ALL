require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const supabase = require('../config/db');
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || 'web'; // 'local' or 'web'
const BASE_URL = 'https://nexshop.cloud';

const PUBLIC_ROUTES = [
    { url: `${BASE_URL}/`, title: 'NexShop Beranda' },
    { url: `${BASE_URL}/legalitas.html`, title: 'Legalitas NexShop' },
    { url: `${BASE_URL}/berita`, title: 'Portal Berita NexShop' },
    // Tambahkan halaman public lainnya sesuai kebutuhan
];

async function ingestWeb() {
    console.log(`🚀 Memulai Ingestion [Mode: ${mode.toUpperCase()}]`);

    let totalChunks = 0;
    
    // 1. Ingest Static Pages via HTTP/Axios (Web Mode)
    if (mode === 'web') {
        for (const route of PUBLIC_ROUTES) {
            console.log(`\nFetching ${route.url}...`);
            try {
                const res = await axios.get(route.url);
                const html = res.data;
                const chunks = parseHtmlToChunks(html, route.url, route.title);
                await upsertChunks(chunks);
                totalChunks += chunks.length;
            } catch (err) {
                console.error(`❌ Gagal fetch ${route.url}:`, err.message);
            }
        }
    } else {
        // Local mode fallback (simulating parsing from local HTML files)
        const frontendDir = path.join(__dirname, '../../nexshop-frontend');
        const localRoutes = [
            { file: 'index.html', title: 'NexShop Beranda' },
            { file: 'legalitas.html', title: 'Legalitas NexShop' }
        ];

        for (const route of localRoutes) {
            const filePath = path.join(frontendDir, route.file);
            if (fs.existsSync(filePath)) {
                console.log(`\nReading ${filePath}...`);
                const html = fs.readFileSync(filePath, 'utf8');
                const chunks = parseHtmlToChunks(html, `${BASE_URL}/${route.file}`, route.title);
                await upsertChunks(chunks);
                totalChunks += chunks.length;
            }
        }
    }

    // 2. Ingest News Articles from Database (Direct Database Source for reliability)
    console.log(`\nFetching Published News from Database...`);
    const { data: newsArticles, error: newsErr } = await supabase
        .from('news_articles')
        .select('id, title, excerpt, content, slug, category, published_at')
        .eq('status', 'published');

    if (newsErr) {
        console.error('❌ Gagal fetch news_articles:', newsErr.message);
    } else if (newsArticles && newsArticles.length > 0) {
        const newsChunks = [];
        newsArticles.forEach(article => {
            const articleText = `${article.title}\n\n${article.excerpt || ''}\n\n${article.content || ''}`.replace(/<[^>]+>/g, '').trim();
            const sourceUrl = `${BASE_URL}/berita/${article.slug}`;
            
            // Clean markdown/HTML
            const cleanedText = articleText.substring(0, 1500); // chunk if too long

            const hash = crypto.createHash('md5').update(cleanedText).digest('hex');
            newsChunks.push({
                title: `Berita: ${article.title}`,
                category: "News",
                keywords: `${article.category} berita news`,
                content: cleanedText,
                status: "active",
                priority: 3,
                source_url: sourceUrl,
                source_title: `NexShop Berita: ${article.title}`,
                content_hash: hash,
                chunk_index: 0,
                updated_at: new Date().toISOString()
            });
        });
        
        await upsertChunks(newsChunks);
        totalChunks += newsChunks.length;
    }

    console.log(`\n✅ Ingestion Selesai! Total Chunks Processed: ${totalChunks}`);
    process.exit(0);
}

function parseHtmlToChunks(html, sourceUrl, sourceTitle) {
    const $ = cheerio.load(html);

    // Hapus tag yang tidak diperlukan
    $('script, style, noscript, svg, nav, footer, iframe, .cookie-banner, .modal').remove();

    const chunks = [];
    let currentIndex = 0;

    // Prioritaskan semantic chunking berdasar heading atau container
    $('main, article, section, .legal-container, .faq-container').each((_, el) => {
        const title = $(el).find('h1, h2, h3').first().text().trim() || sourceTitle;
        const textContent = $(el).text().replace(/\s+/g, ' ').trim();

        if (textContent.length > 50) {
            const hash = crypto.createHash('md5').update(textContent).digest('hex');
            chunks.push({
                title: title.substring(0, 100),
                category: "Website",
                keywords: "website page info",
                content: textContent.substring(0, 2000), // Batasi panjang content
                status: "active",
                priority: 5,
                source_url: sourceUrl,
                source_title: sourceTitle,
                content_hash: hash,
                chunk_index: currentIndex++,
                updated_at: new Date().toISOString()
            });
        }
    });

    return chunks;
}

async function upsertChunks(chunks) {
    if (!chunks.length) return;

    for (const chunk of chunks) {
        // Cek apakah chunk sudah ada berdasarkan content_hash (deduplication)
        const { data: existing } = await supabase
            .from('knowledge_base')
            .select('id, content_hash')
            .eq('content_hash', chunk.content_hash)
            .maybeSingle();

        if (existing) {
            console.log(`   ⏭️  Skip: Hash ${chunk.content_hash} (Already exists)`);
        } else {
            const { error } = await supabase.from('knowledge_base').insert([chunk]);
            if (error) {
                console.error(`   ❌ Failed to insert chunk from ${chunk.source_url}:`, error.message);
            } else {
                console.log(`   ✅ Inserted: ${chunk.title}`);
            }
        }
    }
}

// Run script
ingestWeb();
