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

function dapatkanWaktuWIB() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }) + ' WIB';
}

function getTanggalWIB() {
    const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const { y, m, d } = partsInTZ(new Date(), 'Asia/Jakarta');
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

// ================= DASHBOARD =================
// (isi HTML dashboard kamu tetap sama, dipersingkat di sini)
app.get('/', (req, res) => {
    res.send(`<h1>Server API Live Draw USA</h1><p>Waktu Server: ${dapatkanWaktuWIB()}</p>`);
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

    const cacheKey = `${state}/${targetGame}/${iso(partsInTZ(new Date(), tz))}`;
    const hit = okCache.get(cacheKey);
    if (hit && Date.now() - hit.t < OK_TTL_MS) {
        return res.json({ ...hit.v, tanggal_wib: getTanggalWIB() });
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

        // --- Bandingkan dengan HARI INI di zona negara bagian tsb ---
        if (iso(tglUndian) !== iso(tzNow)) {
            return res.json({
                status: 'belum_update',
                pesan: `Belum update: web masih ${iso(tglUndian)}, hari ini di ${tz} adalah ${iso(tzNow)}`
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

        const payload = {
            status: 'sukses',
            pasaran: namaPasaran,
            tanggal_wib: getTanggalWIB(),
            tanggal_undian_us: iso(tglUndian),
            zona_undian: tz,
            angka_keluar: angka.join('')
        };
        okCache.set(cacheKey, { t: Date.now(), v: payload });
        res.json(payload);
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
