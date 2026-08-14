const { normalizeQuery, detectIntent, detectEntities, inferKnowledgeIntent } = require('./nexshop-backend/utils/nexbotEngine');

const b = [
    { id:'l', title:'Legalitas', category:'Trust', keywords:'legal oss nib', content:'...', status:'active', priority:5 },
    { id:'g', title:'Apakah Progress Game Aman pada Game Pass Sharing', category:'Guide', keywords:'aman sharing', content:'...', status:'active', priority:1 },
    { id:'p', title:'Pembayaran', category:'Payment', keywords:'bayar', content:'...', status:'active', priority:5 },
    { id:'e', title:'Escrow', category:'Trust', keywords:'escrow', content:'...', status:'active', priority:5 }
];

function ev(qStr) {
    const q = normalizeQuery(qStr);
    const intent = detectIntent(q);
    const entities = detectEntities(q);
    console.log('\n=== QUERY: ' + qStr + ' ===');
    console.log('Intent: ' + intent);
    
    b.forEach(item => {
        const title = String(item.title).toLowerCase();
        const keywords = String(item.keywords).toLowerCase();
        const content = String(item.content).toLowerCase();
        const haystack = title + ' ' + keywords + ' ' + content;
        const escapeRegExp = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matchedTokens = q.tokens.filter(t => new RegExp('\\b'+escapeRegExp(t)+'\\b').test(haystack)).length;
        const titleTokens = q.tokens.filter(t => new RegExp('\\b'+escapeRegExp(t)+'\\b').test(title)).length;
        const entityMatches = entities.filter(e => title.includes(e.toLowerCase())).length;
        const knowledgeIntent = inferKnowledgeIntent(item);
        
        const isStrict = ['Trust', 'Legality', 'Payment', 'Refund', 'Escrow'].includes(intent);
        const related = {
            Trust: ['Trust', 'Legality', 'Escrow'],
            Legality: ['Trust', 'Legality'],
            Escrow: ['Trust', 'Escrow', 'Payment'],
            Payment: ['Payment', 'Escrow']
        };

        let intentScore = intent === knowledgeIntent ? 35 : (related[intent] && related[intent].includes(knowledgeIntent) ? 15 : (intent === 'GeneralQuestion' || knowledgeIntent === 'GeneralQuestion' ? (isStrict ? -15 : 4) : -25));
        
        const trigrams = t => { const v='  '+String(t||'').toLowerCase()+'  '; const r=new Set(); for(let i=0;i<v.length-2;i++)r.add(v.slice(i,i+3)); return r;}; 
        const similarity = (l,r) => {const a=trigrams(l);const b=trigrams(r);if(!a.size||!b.size)return 0;let c=0;a.forEach(p=>{if(b.has(p))c++});return c/(a.size+b.size-c);}; 
        const semantic = similarity(q.raw, title + ' ' + keywords); 

        const finalScore = Math.round(intentScore + Math.min(32, entityMatches * 18) + Math.min(20, titleTokens * 8) + Math.min(12, matchedTokens * 3) + semantic * 20 + Math.min(6, item.priority || 0));
        
        console.log(`[${item.title}] KI: ${knowledgeIntent} -> Score: ${finalScore} (Intent: ${intentScore}, TitleTokens: ${titleTokens}, Matched: ${matchedTokens}, Sem: ${semantic.toFixed(2)})`);
    });
}

ev('Apakah NexShop aman?');
ev('Apakah NexShop legal?');
ev('Apakah progress game aman pada Game Pass Sharing?');
ev('Pembayaran pakai apa?');
ev('Ada escrow?');
