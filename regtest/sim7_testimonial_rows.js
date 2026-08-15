// Regression test: logic split/pad/duplicate baris testimoni (renderTestimonials)
function splitAndPad(items) {
    const row1Items = items.filter((_, i) => i % 2 === 0);
    const row2Items = items.filter((_, i) => i % 2 === 1);

    const padRow = (arr) => {
        if (arr.length === 0) return items;
        let padded = [...arr];
        while (padded.length < 6) padded = padded.concat(arr);
        return padded;
    };

    const finalRow1 = padRow(row1Items.length ? row1Items : items);
    const finalRow2 = padRow(row2Items.length ? row2Items : items);

    // Simulasi apa yang di-render: tiap baris diduplikasi 2x (buat animasi
    // translateX(-50%) looping mulus)
    return {
        row1: [...finalRow1, ...finalRow1],
        row2: [...finalRow2, ...finalRow2]
    };
}

let allPass = true;
function check(name, cond) {
    console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
    if (!cond) allPass = false;
}

// Kasus 1: banyak testimoni (20 item, kondisi normal)
const many = Array.from({ length: 20 }, (_, i) => ({ id: i }));
const r1 = splitAndPad(many);
check("20 item: row1 tidak kosong", r1.row1.length > 0);
check("20 item: row2 tidak kosong", r1.row2.length > 0);
check("20 item: row genap-duplikasi (panjang selalu kelipatan 2)", r1.row1.length % 2 === 0 && r1.row2.length % 2 === 0);

// Kasus 2: cuma 1 testimoni (edge case ekstrem)
const one = [{ id: "only" }];
const r2 = splitAndPad(one);
check("1 item: tidak infinite loop / selesai", true); // kalau sampai sini berarti gak infinite loop
check("1 item: row1 tetap terisi (fallback ke items)", r2.row1.length > 0);
check("1 item: row2 tetap terisi (fallback ke items, bukan array kosong)", r2.row2.length > 0);

// Kasus 3: 3 testimoni (ganjil, row2 lebih pendek dari row1 sebelum padding)
const three = [{ id: 1 }, { id: 2 }, { id: 3 }];
const r3 = splitAndPad(three);
check("3 item: row1 (index genap: 0,2) minimal 6 sebelum duplikasi akhir", r3.row1.length >= 12);
check("3 item: row2 (index ganjil: 1) tetap terisi walau cuma 1 item asli", r3.row2.length > 0);

// Kasus 4: array kosong (tidak boleh dipanggil render sama sekali di kode
// asli -- renderTestimonials sudah guard `items.length === 0` duluan -- tapi
// pastikan fungsi split sendiri tidak crash kalau somehow dipanggil)
const empty = [];
const r4 = splitAndPad(empty);
check("array kosong: tidak crash, row1 kosong (items kosong jadi fallback ke items kosong juga)", Array.isArray(r4.row1));

process.exit(allPass ? 0 : 1);
