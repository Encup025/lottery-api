const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ================= ZONA WAKTU =================
const STATE_TZ = {
    'texas': 'America/Chicago',
    'missouri': 'America/Chicago',
    'iowa': 'America/Chicago',
    'california': 'America/Los_Angeles',
    'oregon': 'America/Los_Angeles',
    'arizona': 'America/Phoenix',
    'indiana': 'America/Indiana/Indianapolis', // Eastern
    'kentucky': 'America/New_York',
    'florida': 'America/New_York',
    'new-york': 'America/New_York',
    'washington-dc': 'America/New_York',
    'north-carolina': 'America/New_York',
    'virginia': 'America/New_York',
    'georgia': 'America/New_York',
    'new-jersey': 'America/New_York'
};

// Alias URL: key = state/game dari bot, value = game di web target
const GAME_ALIAS = {
    'florida/pick-4-midday': 'midday-pick-4',
    'florida/pick-4-evening': 'pick-4',
    'kentucky/pick-4-evening': 'pick-4'
};

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// Ambil Y/M/D di zona tertentu TANPA trik new Date(toLocaleString)
function partsInTZ(date, tz) {
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day };
}

const iso = ({ y, m, d }) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// Selisih zona terhadap UTC (ms) pada waktu tertentu, sudah memperhitungkan DST
function tzOffsetMs(date, tz) {
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

// Jam dinding lokal (mis. 12:29 di America/New_York) -> Date (instant) yang benar
function localToDate(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let t = guess - tzOffsetMs(new Date(guess), tz);
    t = guess - tzOffsetMs(new Date(t), tz);
    return new Date(t);
}

function jamWIB(date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date) + ' WIB';
}

// Jadwal undian dalam JAM LOKAL negara bagian (DST ditangani otomatis).
// Key = state/game seperti yang dipanggil bot. PERKIRAAN - cocokkan dengan
// jadwal resmi tiap lotre. Game yang tidak ada di sini memakai waktu sekarang.
const JADWAL = {
    'texas/morning-daily-4': '10:00',
    'texas/day-daily-4': '12:27',
    'texas/evening-daily-4': '18:00',
    'texas/night-daily-4': '22:12',
    'oregon/1-pm-pick-4': '13:00',
    'oregon/4-pm-pick-4': '16:00',
    'oregon/7-pm-pick-4': '19:00',
    'oregon/10-pm-pick-4': '22:00',
    'kentucky/midday-pick-4': '13:25',
    'kentucky/pick-4': '23:00',          // cek lagi
    'florida/pick-4-midday': '13:30',
    'florida/pick-4-evening': '21:45',
    'new-york/midday-win-4': '14:30',
    'new-york/win-4': '22:30',
    'washington-dc/dc-4-midday': '13:50',
    'washington-dc/dc-4': '19:50',
    'north-carolina/midday-pick-4': '15:00',
    'north-carolina/pick-4': '23:22',
    'virginia/midday-4': '13:59',
    'virginia/pick-4': '23:00',
    'georgia/midday-4': '12:29',
    'georgia/cash-4-evening': '18:59',
    'missouri/midday-pick-4': '12:45',   // cek lagi
    'missouri/pick-4': '21:00',          // cek lagi
    'indiana/midday-4': '12:59',         // cek lagi
    'indiana/daily-4': '22:59',          // cek lagi
    'new-jersey/midday-pick-4': '12:59',
    'new-jersey/pick-4': '22:57',
    'california/daily-4': '18:30',
    'arizona/pick-4-midday': '12:05',
    'arizona/pick-4': '19:00',
    'iowa/midday-4': '12:20',
    'iowa/pick-4': '22:00'
};

// Dipakai untuk game yang belum ada di JADWAL. 13:00 lokal aman untuk undian
// yang jatuh setelah jam 12:00 (Central) / 10:00 (Arizona): hasilnya +1 hari WIB.
const JAM_DEFAULT = '13:00';

function dapatkanWaktuWIB() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }) + ' WIB';
}

function getTanggalWIB(waktu = new Date()) {
    const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const { y, m, d } = partsInTZ(waktu, 'Asia/Jakarta');
    const hr = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return `${hari[hr]}, ${d} ${bulan[m - 1]} ${y}`;
}

// Parse tanggal dari teks/atribut. Return {y,m,d} atau null
function parseTanggal(str, tzNow) {
    if (!str) return null;
    str = str.toLowerCase();

    // Format ISO: 2026-10-19
    let m = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };

    // Format: "oct 19, 2026" / "october 19" (tahun opsional)
    m = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:,?\s*(\d{4}))?/);
    if (m) {
        const bulan = MONTHS.indexOf(m[1]) + 1;
        let tahun = m[3] ? +m[3] : tzNow.y;
        // Tanpa tahun & bulan "di masa depan" = tahun lalu (mis. Des dibaca di Jan)
        if (!m[3] && bulan > tzNow.m + 1) tahun -= 1;
        return { y: tahun, m: bulan, d: +m[2] };
    }
    return null;
}

// ================= FETCH ANTI BLOK (PARALEL) =================
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

const diblokCF = (data) =>
    typeof data !== 'string' ||
    data.includes('Just a moment...') ||
    data.includes('Attention Required');

async function ambil(url, headers) {
    const res = await axios.get(url, { headers, timeout: 4500 });
    if (res.status !== 200 || diblokCF(res.data)) throw new Error('blocked');
    return res.data;
}

async function fetchWithAntiBlock(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    try {
        // Ambil yang pertama berhasil, jadi total waktu maksimal ~4.5 detik
        return await Promise.any([
            ambil(targetUrl, HEADERS),
            ambil(`https://api.allorigins.win/raw?url=${enc}`, {}),
            ambil(`https://api.codetabs.com/v1/proxy?quest=${enc}`, {})
        ]);
    } catch (e) {
        throw new Error('Diblokir Cloudflare: semua jalur akses gagal.');
    }
}

// ================= CACHE HASIL VALID =================
// Hanya hasil yang sudah lolos validasi (tanggal hari ini + 4 angka)
// yang di-cache. "Belum update" TIDAK di-cache supaya bot tidak telat.
const okCache = new Map();
const OK_TTL_MS = 5 * 60 * 1000;

// Respons default RINGKAS (hanya yang dibaca bot). Tambah ?debug=1 untuk info lengkap.
function bentukRespons(full, debug) {
    if (debug) return full;
    const { status, pasaran, tanggal_wib, angka_keluar } = full;
    return { status, pasaran, tanggal_wib, angka_keluar };
}

// ================= DASHBOARD =================
app.get('/', (req, res) => {
    const waktuWIB = dapatkanWaktuWIB();
    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard API Live Draw USA</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; margin: 0; padding: 20px; }
            .container { max-width: 1000px; margin: 0 auto; }
            h1 { color: #00e676; text-align: center; margin-bottom: 5px; }
            .waktu { text-align: center; color: #aaaaaa; margin-bottom: 30px; font-size: 1.1em; background: #1e1e1e; padding: 10px; border-radius: 8px; border: 1px solid #333;}
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .market-card { background: #1e1e1e; padding: 15px; border-radius: 8px; border-left: 5px solid #03a9f4; }
            .market-card h2 { margin-top: 0; color: #03a9f4; font-size: 1.2em; border-bottom: 1px solid #333; padding-bottom: 10px; }
            a { display: block; color: #ff9800; text-decoration: none; font-weight: bold; background: #2c2c2c; padding: 12px; margin-bottom: 10px; border-radius: 5px; text-align: center; transition: 0.3s;}
            a:hover { background: #ff9800; color: #121212; }
            .btn-utama { background: #d32f2f; border-left: 5px solid #d32f2f; }
            .btn-utama a { color: white; background: #b71c1c; }
            .btn-utama a:hover { background: #ff5252; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw USA</h1>
            <div class="waktu">Waktu Server: <strong>${waktuWIB}</strong></div>
            <div class="market-card btn-utama" style="margin-bottom: 20px;">
                <h2 style="color:white;">🌐 Pasaran Nasional</h2>
                <a href="/api/markets" target="_blank">Lihat Semua Pasaran Utama (Powerball, dll)</a>
            </div>
            <div class="grid">
                <div class="market-card">
                    <h2>⭐ Texas</h2>
                    <a href="/api/result/texas/morning-daily-4" target="_blank">Morning Daily 4</a>
                    <a href="/api/result/texas/day-daily-4" target="_blank">Day Daily 4</a>
                    <a href="/api/result/texas/evening-daily-4" target="_blank">Evening Daily 4</a>
                    <a href="/api/result/texas/night-daily-4" target="_blank">Night Daily 4</a>
                </div>
                <div class="market-card">
                    <h2>🌲 Oregon</h2>
                    <a href="/api/result/oregon/1-pm-pick-4" target="_blank">Oregon 3 (1 PM)</a>
                    <a href="/api/result/oregon/4-pm-pick-4" target="_blank">Oregon 6 (4 PM)</a>
                    <a href="/api/result/oregon/7-pm-pick-4" target="_blank">Oregon 9 (7 PM)</a>
                    <a href="/api/result/oregon/10-pm-pick-4" target="_blank">Oregon 12 (10 PM)</a>
                </div>
                <div class="market-card">
                    <h2>🍗 Kentucky</h2>
                    <a href="/api/result/kentucky/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/kentucky/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍊 Florida</h2>
                    <a href="/api/result/florida/pick-4-midday" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/florida/pick-4-evening" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🗽 New York</h2>
                    <a href="/api/result/new-york/midday-win-4" target="_blank">Midday Win 4</a>
                    <a href="/api/result/new-york/win-4" target="_blank">Win 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏛️ Washington DC</h2>
                    <a href="/api/result/washington-dc/dc-4-midday" target="_blank">DC-4 Midday</a>
                    <a href="/api/result/washington-dc/dc-4" target="_blank">DC-4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌲 North Carolina</h2>
                    <a href="/api/result/north-carolina/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/north-carolina/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🦅 Virginia</h2>
                    <a href="/api/result/virginia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/virginia/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🍑 Georgia</h2>
                    <a href="/api/result/georgia/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/georgia/cash-4-evening" target="_blank">Cash 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🐻 Missouri</h2>
                    <a href="/api/result/missouri/midday-pick-4" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/missouri/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏎️ Indiana & NJ</h2>
                    <a href="/api/result/indiana/midday-4" target="_blank">IN Midday 4</a>
                    <a href="/api/result/indiana/daily-4" target="_blank">IN Daily 4</a>
                    <a href="/api/result/new-jersey/midday-pick-4" target="_blank">NJ Midday Pick 4</a>
                    <a href="/api/result/new-jersey/pick-4" target="_blank">NJ Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏖️ California</h2>
                    <a href="/api/result/california/daily-4" target="_blank">Daily 4</a>
                </div>
                <div class="market-card">
                    <h2>🌵 Arizona</h2>
                    <a href="/api/result/arizona/pick-4-midday" target="_blank">Midday Pick 4</a>
                    <a href="/api/result/arizona/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🌽 Iowa</h2>
                    <a href="/api/result/iowa/midday-4" target="_blank">Midday 4</a>
                    <a href="/api/result/iowa/pick-4" target="_blank">Pick 4 Evening</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// ================= ENDPOINT HASIL =================
app.get('/api/result/:state/:game', async (req, res) => {
    const { state, game } = req.params;

    // Whitelist + validasi format
    const tz = STATE_TZ[state];
    if (!tz || !/^[a-z0-9-]+$/.test(game)) {
        return res.status(404).json({ status: 'error', pesan: 'State atau game tidak dikenal.' });
    }

    const targetGame = GAME_ALIAS[`${state}/${game}`] || game;
    const targetUrl = `https://www.lotteryusa.com/${state}/${targetGame}/`;

    const cacheKey = `${state}/${targetGame}/${iso(partsInTZ(new Date(), 'Asia/Jakarta'))}`;
    const hit = okCache.get(cacheKey);
    if (hit && Date.now() - hit.t < OK_TTL_MS) {
        return res.json(bentukRespons(hit.v, req.query.debug === '1'));
    }

    try {
        const html = await fetchWithAntiBlock(targetUrl);
        const $ = cheerio.load(html);

        let namaPasaran = $('h1').first().text().replace(/winning numbers/i, '')
            .replace(/\s+/g, ' ').trim().toUpperCase() || `${state} ${game}`.toUpperCase();

        // Blok hasil paling atas
        const blok = $('.c-game-components').first().length
            ? $('.c-game-components').first()
            : $('main').first();

        const tzNow = partsInTZ(new Date(), tz);

        // Jangkar: bola pertama yang BUKAN fireball
        const bolaPertama = blok.find('[class*="ball"]').filter((i, el) => {
            const cls = ($(el).attr('class') || '').toLowerCase();
            return !cls.includes('fire') && !$(el).closest('[class*="fire"]').length;
        }).first();

        if (!bolaPertama.length) {
            return res.json({ status: 'belum_update', pesan: 'Belum update: angka belum tersedia' });
        }

        // Naik dari bola sampai ketemu wadah yang memuat tanggal, supaya tanggal
        // yang dibaca milik hasil yang SAMA dengan angka (bukan jadwal "next draw")
        let tglRaw = '';
        let wadah = bolaPertama.parent();
        for (let i = 0; i < 6 && wadah.length && !tglRaw; i++) {
            const el = wadah.find('time, [class*="date"]').first();
            tglRaw = (el.attr('datetime') || el.text() || '').trim();
            if (!tglRaw) wadah = wadah.parent();
        }
        const tglUndian = parseTanggal(tglRaw, tzNow);

        if (!tglUndian) {
            return res.status(422).json({
                status: 'error',
                pesan: 'Tanggal undian tidak ditemukan pada blok hasil.',
                detail: (tglRaw || '').slice(0, 60)
            });
        }

        // Tanggal di web tidak boleh lebih baru dari hari ini di zona US-nya
        if (iso(tglUndian) > iso(tzNow)) {
            return res.json({
                status: 'belum_update',
                pesan: `Belum update: tanggal web ${iso(tglUndian)} lebih baru dari hari ini di ${tz} (${iso(tzNow)})`
            });
        }

        // Terjemahkan tanggal web -> WIB (tanggal + jam undian, DST otomatis)
        const jam = JADWAL[`${state}/${game}`];
        const [hh, mm] = (jam || JAM_DEFAULT).split(':').map(Number);
        const waktuUndian = localToDate(tglUndian.y, tglUndian.m, tglUndian.d, hh, mm, tz);

        // Tanggal WIB undian harus = hari ini di WIB (sama dengan pandangan bot)
        const wibUndian = iso(partsInTZ(waktuUndian, 'Asia/Jakarta'));
        const wibHariIni = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
        if (wibUndian !== wibHariIni) {
            return res.json({
                status: 'belum_update',
                pesan: `Belum update: undian di web (${iso(tglUndian)} US) jatuh ${wibUndian} WIB, hari ini ${wibHariIni} WIB`
            });
        }

        // --- Ambil angka utama, abaikan Fireball ---
        const angka = [];
        if (bolaPertama.length) {
            bolaPertama.parent().find('[class*="ball"]').each((i, el) => {
                const $el = $(el);
                const cls = ($el.attr('class') || '').toLowerCase();
                if (cls.includes('fire')) return;            // skip fireball
                if ($el.closest('[class*="fire"]').length) return;
                const t = $el.text().trim();
                if (/^\d$/.test(t) && angka.length < 4) angka.push(t);
            });
        }

        if (angka.length !== 4) {
            return res.json({
                status: 'belum_update',
                pesan: `Belum update: angka belum lengkap (${angka.length}/4)`
            });
        }

        const tglWib = getTanggalWIB(waktuUndian);
        const waktuWib = jam ? jamWIB(waktuUndian) : null;

        const payload = {
            status: 'sukses',
            pasaran: namaPasaran,
            tanggal_wib: tglWib,
            waktu_undian_wib: waktuWib,
            tanggal_undian_us: iso(tglUndian),
            zona_undian: tz,
            angka_keluar: angka.join('')
        };
        okCache.set(cacheKey, { t: Date.now(), v: payload });
        res.json(bentukRespons(payload, req.query.debug === '1'));
    } catch (error) {
        res.status(500).json({ status: 'error', pesan: 'Gagal mengambil data dari target', detail: error.message });
    }
});

// ================= PASARAN UTAMA =================
app.get('/api/markets', async (req, res) => {
    try {
        const html = await fetchWithAntiBlock('https://www.lotteryusa.com/');
        const $ = cheerio.load(html);
        const markets = [];
        const bukanLotre = ['PLAY', 'Play online', 'Daily game stats', 'On this day'];

        $('h3').each((i, element) => {
            const nama = $(element).text().trim();
            if (!nama || bukanLotre.includes(nama) || nama.includes('?') || nama.length > 25) return;

            let parent = $(element).parent();
            let angka = [], tanggal = 'Belum diundi', jackpot = 'N/A';

            for (let level = 0; level < 5; level++) {
                parent.find('[class*="ball"]').each((j, b) => {
                    const t = $(b).text().trim();
                    if (t && t.length <= 3) angka.push(t);
                });
                if (angka.length > 0) {
                    tanggal = parent.find('time, [class*="date"]').first().text().trim() || tanggal;
                    parent.find('[class*="jackpot"], [class*="prize"]').each((j, jp) => {
                        const t = $(jp).text().trim();
                        if (t.includes('$')) jackpot = t.replace(/\s+/g, ' ');
                    });
                    break;
                }
                parent = parent.parent();
            }
            if (angka.length > 0) markets.push({ pasaran: nama, tanggal_undian: tanggal, jackpot, angka_keluar: angka });
        });

        res.json({ status: 'sukses', waktu_update_wib: dapatkanWaktuWIB(), total_pasaran: markets.length, data: markets });
    } catch (error) {
        res.status(500).json({ status: 'error', pesan: error.message });
    }
});

module.exports = app;
