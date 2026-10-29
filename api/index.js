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
    'indiana': 'America/Indiana/Indianapolis',
    'kentucky': 'America/New_York',
    'florida': 'America/New_York',
    'new-york': 'America/New_York',
    'washington-dc': 'America/New_York',
    'north-carolina': 'America/New_York',
    'virginia': 'America/New_York',
    'georgia': 'America/New_York',
    'new-jersey': 'America/New_York'
};

// Slug negara bagian pada LotteryUSA.
const STATE_SLUG = {
    'washington-dc': 'district-of-columbia'
};

// Alias endpoint API -> slug game asli LotteryUSA.
const GAME_ALIAS = {
    'texas/morning-daily-4': 'morning-pick-4',
    'texas/day-daily-4': 'midday-4',
    'texas/evening-daily-4': 'evening-pick-4',
    'texas/night-daily-4': 'daily-4',

    'oregon/1-pm-pick-4': 'pick-4-1pm',
    'oregon/4-pm-pick-4': 'pick-4-4pm',
    'oregon/7-pm-pick-4': 'pick-4-7pm',
    'oregon/10-pm-pick-4': 'pick-4-10pm',

    'florida/pick-4-midday': 'midday-pick-4',
    'florida/pick-4-evening': 'pick-4',

    'kentucky/pick-4-evening': 'pick-4'
};

const MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
];

// ================= HELPER TANGGAL =================

function partsInTZ(date, tz) {
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const p = Object.fromEntries(
        f.formatToParts(date).map(x => [x.type, x.value])
    );

    return {
        y: Number(p.year),
        m: Number(p.month),
        d: Number(p.day)
    };
}

const iso = ({ y, m, d }) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function tanggalValid(value) {
    if (!value) return false;

    const match = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})$/
    );

    if (!match) return false;

    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);

    const date = new Date(Date.UTC(y, m - 1, d));

    return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
    );
}

function tzOffsetMs(date, tz) {
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const p = Object.fromEntries(
        f.formatToParts(date).map(x => [x.type, x.value])
    );

    const asUTC = Date.UTC(
        Number(p.year),
        Number(p.month) - 1,
        Number(p.day),
        Number(p.hour),
        Number(p.minute),
        Number(p.second)
    );

    return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

function localToDate(y, m, d, hh, mm, tz) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);

    let t = guess - tzOffsetMs(new Date(guess), tz);
    t = guess - tzOffsetMs(new Date(t), tz);

    return new Date(t);
}

function jamWIB(date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(date) + ' WIB';
}

function dapatkanWaktuWIB() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }) + ' WIB';
}

function getTanggalWIB(waktu = new Date()) {
    const hari = [
        'Minggu', 'Senin', 'Selasa', 'Rabu',
        'Kamis', 'Jumat', 'Sabtu'
    ];

    const bulan = [
        'Januari', 'Februari', 'Maret', 'April',
        'Mei', 'Juni', 'Juli', 'Agustus',
        'September', 'Oktober', 'November', 'Desember'
    ];

    const { y, m, d } = partsInTZ(waktu, 'Asia/Jakarta');
    const hr = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    return `${hari[hr]}, ${d} ${bulan[m - 1]} ${y}`;
}

// Parse ISO, "Oct 19, 2026", dan "October 19".
function parseTanggal(str, tzNow) {
    if (!str) return null;

    str = String(str).toLowerCase().trim();

    let match = str.match(/(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
        const hasil = {
            y: Number(match[1]),
            m: Number(match[2]),
            d: Number(match[3])
        };

        return tanggalValid(iso(hasil)) ? hasil : null;
    }

    match = str.match(
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:,?\s*(\d{4}))?/
    );

    if (match) {
        const bulan = MONTHS.indexOf(match[1]) + 1;
        let tahun = match[3] ? Number(match[3]) : tzNow.y;

        if (!match[3] && bulan > tzNow.m + 1) {
            tahun -= 1;
        } else if (!match[3] && tzNow.m === 1 && bulan === 12) {
            tahun -= 1;
        }

        const hasil = {
            y: tahun,
            m: bulan,
            d: Number(match[2])
        };

        return tanggalValid(iso(hasil)) ? hasil : null;
    }

    return null;
}

// ================= JADWAL UNDIAN =================
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
    'kentucky/pick-4': '23:00',

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

    'missouri/midday-pick-4': '12:45',
    'missouri/pick-4': '21:00',

    'indiana/midday-4': '12:59',
    'indiana/daily-4': '22:59',

    'new-jersey/midday-pick-4': '12:59',
    'new-jersey/pick-4': '22:57',

    'california/daily-4': '18:30',

    'arizona/pick-4-midday': '12:05',
    'arizona/pick-4': '19:00',

    'iowa/midday-4': '12:20',
    'iowa/pick-4': '22:00'
};

const JAM_DEFAULT = '13:00';

// Slot pasaran WIB.
const SLOT_WIB = {
    'kentucky/midday-pick-4': '00:11',
    'florida/pick-4-midday': '00:21',
    'texas/day-daily-4': '00:30',
    'washington-dc/dc-4-midday': '00:55',
    'virginia/midday-4': '01:00',
    'new-jersey/midday-pick-4': '01:00',
    'new-york/midday-win-4': '01:15',
    'iowa/midday-4': '01:30',
    'north-carolina/midday-pick-4': '01:51',
    'oregon/1-pm-pick-4': '02:51',
    'arizona/pick-4-midday': '03:00',
    'oregon/4-pm-pick-4': '05:51',
    'texas/evening-daily-4': '06:00',
    'washington-dc/dc-4': '07:00',
    'florida/pick-4-evening': '08:35',
    'oregon/7-pm-pick-4': '08:51',
    'arizona/pick-4': '09:00',
    'new-york/win-4': '09:25',
    'kentucky/pick-4': '09:51',
    'virginia/pick-4': '10:00',
    'iowa/pick-4': '10:00',
    'north-carolina/pick-4': '10:12',
    'california/daily-4': '10:13',
    'texas/night-daily-4': '10:15',
    'oregon/10-pm-pick-4': '11:51',
    'texas/morning-daily-4': '22:00'
};

function slotWIB(tglUS, tz, slot) {
    const [hh, mm] = slot.split(':').map(Number);

    const mulai = localToDate(
        tglUS.y, tglUS.m, tglUS.d, 0, 0, tz
    );

    const tanggalBerikutnya = new Date(
        Date.UTC(tglUS.y, tglUS.m - 1, tglUS.d + 1)
    );

    const selesai = localToDate(
        tanggalBerikutnya.getUTCFullYear(),
        tanggalBerikutnya.getUTCMonth() + 1,
        tanggalBerikutnya.getUTCDate(),
        0, 0, tz
    );

    const w = partsInTZ(mulai, 'Asia/Jakarta');

    for (let add = 0; add <= 1; add++) {
        const candidate = localToDate(
            w.y, w.m, w.d + add, hh, mm, 'Asia/Jakarta'
        );

        if (candidate >= mulai && candidate < selesai) {
            return candidate;
        }
    }

    return null;
}

// ================= FETCH =================

// Rotasi User-Agent agar lebih aman dari blokir Cloudflare
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomHeaders() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    };
}

const diblokCF = data => {
    if (typeof data !== 'string') return true;

    const lower = data.toLowerCase();

    return (
        lower.includes('just a moment...') ||
        lower.includes('attention required') ||
        lower.includes('cf-chl-') ||
        lower.includes('cloudflare ray id')
    );
};

async function ambil(url) {
    const headers = getRandomHeaders();
    
    const res = await axios.get(url, {
        headers,
        timeout: 8000,
        responseType: 'text',
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400
    });

    if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
    }

    if (diblokCF(res.data)) {
        throw new Error('Halaman ditolak atau menampilkan challenge Cloudflare.');
    }

    if (typeof res.data !== 'string' || res.data.length < 100) {
        throw new Error('Respons HTML kosong atau terlalu pendek.');
    }

    return res.data;
}

// Deduplicasi request untuk URL yang sama dalam satu instance.
const inFlightFetch = new Map();

async function fetchWithAntiBlock(targetUrl) {
    const existing = inFlightFetch.get(targetUrl);

    if (existing) {
        return existing;
    }

    const request = (async () => {
        return await ambil(targetUrl);
    })();

    inFlightFetch.set(targetUrl, request);

    try {
        return await request;
    } finally {
        if (inFlightFetch.get(targetUrl) === request) {
            inFlightFetch.delete(targetUrl);
        }
    }
}

// ================= SUMBER RESMI FLORIDA =================
const FL_API = 'https://apim-website-prod-eastus.azure-api.net/drawgamesapp/getLatestDrawGames';

const FL_TIPE = {
    'florida/pick-4-midday': 'MIDDAY',
    'florida/pick-4-evening': 'EVENING'
};

async function ambilFloridaResmi(kunci) {
    const respons = await axios.get(FL_API, {
        headers: {
            ...getRandomHeaders(),
            'Accept': 'application/json',
            'x-partner': 'web',
            'Origin': 'https://floridalottery.com',
            'Referer': 'https://floridalottery.com/'
        },
        timeout: 8000
    });

    const list = Array.isArray(respons.data)
        ? respons.data
        : JSON.parse(respons.data);

    const hasil = list
        .filter(x => x.Id === 108 && x.DrawType === FL_TIPE[kunci])
        .map(x => {
            const m = String(x.DrawDate).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

            if (!m) return null;

            const angka = ['wn1', 'wn2', 'wn3', 'wn4'].map(k =>
                (x.DrawNumbers.find(n => n.NumberType === k) || {}).NumberPick
            );

            return {
                tgl: { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) },
                angka
            };
        })
        .filter(x => x && x.angka.every(Number.isInteger))
        .sort((a, b) => iso(b.tgl).localeCompare(iso(a.tgl)));

    return hasil[0] || null;
}

// ================= SUMBER RESMI NEW YORK (INTERNAL API) =================
const NY_INTERNAL_API = 'https://nylottery.ny.gov/nyl-api/games/all/draws';

const NY_TIPE_INTERNAL = {
    'new-york/midday-win-4': 1, 
    'new-york/win-4': 2         
};

async function ambilNewYorkResmi(kunci) {
    const periodTarget = NY_TIPE_INTERNAL[kunci];
    if (!periodTarget) return null;

    try {
        const respons = await axios.get(NY_INTERNAL_API, {
            headers: getRandomHeaders(),
            timeout: 8000
        });

        const dataRoot = respons.data.data ? respons.data.data : respons.data;

        if (!dataRoot || !dataRoot.win4 || !Array.isArray(dataRoot.win4.draws)) {
            return null;
        }

        const hasil = dataRoot.win4.draws
            .filter(x => x.drawPeriod === periodTarget && x.results && x.results.length > 0)
            .map(x => {
                const tglObj = new Date(x.resultDate);
                const { y, m, d } = partsInTZ(tglObj, 'America/New_York');
                const angkaArray = x.results[0].primary;

                return {
                    tgl: { y, m, d },
                    angka: angkaArray
                };
            })
            .filter(x => x && x.angka.length === 4)
            .sort((a, b) => iso(b.tgl).localeCompare(iso(a.tgl)));

        return hasil[0] || null;
    } catch (error) {
        return null;
    }
}

// ================= CACHE HASIL VALID =================
const okCache = new Map();
const OK_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

function getCache(key) {
    const item = okCache.get(key);

    if (!item) return null;

    if (Date.now() - item.t >= OK_TTL_MS) {
        okCache.delete(key);
        return null;
    }

    return item.v;
}

function setCache(key, value) {
    for (const [cacheKey, item] of okCache.entries()) {
        if (Date.now() - item.t >= OK_TTL_MS) {
            okCache.delete(cacheKey);
        }
    }

    while (
        !okCache.has(key) &&
        okCache.size >= CACHE_MAX_ENTRIES
    ) {
        const oldestKey = okCache.keys().next().value;
        if (oldestKey === undefined) break;
        okCache.delete(oldestKey);
    }

    okCache.delete(key);
    okCache.set(key, {
        t: Date.now(),
        v: value
    });
}

// ================= PERUBAHAN FUNGSI RESPONS =================
function bentukRespons(full, debug) {
    if (debug) return full;

    // 1. Jika belum update, kembalikan hanya status & pesan
    if (full.status === 'belum_update') {
        return {
            status: full.status,
            pesan: full.pesan
        };
    }

    // 2. Kunci standar untuk USA dan Macau (TIDAK ADA P1)
    const res = {
        status: full.status,
        pasaran: full.pasaran,
        tanggal_wib: full.tanggal_wib,
        angka_keluar: full.angka_keluar
    };

    // 3. Masukkan jam undian HANYA jika payload punya (Macau / US)
    if (full.waktu_undian_wib) res.waktu_undian_wib = full.waktu_undian_wib;

    // 4. Masukkan P1, P2, P3 HANYA JIKA PASARAN HK (USA & Macau tidak akan terekspos ini)
    if (full.p1) res.p1 = full.p1;
    if (full.p2) res.p2 = full.p2;
    if (full.p3) res.p3 = full.p3;

    return res;
}

// ================= HELPER PARSER HASIL =================
function isFireball($, element) {
    const cls = ($(element).attr('class') || '').toLowerCase();

    return (
        cls.includes('fire') ||
        $(element).closest('[class*="fire"]').length > 0
    );
}

function ambilAngka($, wadah) {
    const angka = [];

    wadah.find('[class*="ball"]').each((i, element) => {
        if (isFireball($, element)) return;

        const teks = $(element).text().trim();

        if (/^\d$/.test(teks)) {
            angka.push(teks);
        }
    });

    return angka;
}

function cariWadahAngka($, bolaPertama) {
    let wadah = bolaPertama.parent();

    for (let i = 0; i < 8 && wadah.length; i++) {
        const angka = ambilAngka($, wadah);

        if (angka.length >= 4) {
            return wadah;
        }

        wadah = wadah.parent();
    }

    return bolaPertama.parent();
}

function cariTanggalRaw($, mulai) {
    let wadah = mulai;

    for (let i = 0; i < 8 && wadah.length; i++) {
        const elemenTanggal = wadah.find(
            'time, [class*="date"]'
        ).first();

        if (elemenTanggal.length) {
            const datetime = (
                elemenTanggal.attr('datetime') || ''
            ).trim();

            const teks = elemenTanggal.text().trim();
            const raw = datetime || teks;

            if (raw) return raw;
        }

        wadah = wadah.parent();
    }

    return '';
}

// ================= DASHBOARD =================
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    const waktuWIB = dapatkanWaktuWIB();

    const html = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard API Live Draw USA & Macau</title>
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
            .macau-card { border-left-color: #e91e63; }
            .macau-card h2 { color: #e91e63; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw USA & Macau</h1>
            <div class="waktu">Waktu Server: <strong>${waktuWIB}</strong></div>
            <div class="market-card btn-utama" style="margin-bottom: 20px;">
                <h2 style="color:white;">🌐 Pasaran Nasional</h2>
                <a href="/api/markets" target="_blank">Lihat Semua Pasaran Utama (Powerball, dll)</a>
            </div>
            <div class="grid">
                <div class="market-card macau-card">
                    <h2>🇲🇴 Toto Macau (4D)</h2>
                    <a href="/api/result/macau/1300" target="_blank">Putaran 13:00</a>
                    <a href="/api/result/macau/1600" target="_blank">Putaran 16:00</a>
                    <a href="/api/result/macau/1900" target="_blank">Putaran 19:00</a>
                    <a href="/api/result/macau/2200" target="_blank">Putaran 22:00</a>
                    <a href="/api/result/macau/2300" target="_blank">Putaran 23:00</a>
                    <a href="/api/result/macau/0000" target="_blank">Putaran 00:00</a>
                </div>
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

// ================= ENDPOINT HONGKONG POOLS =================
app.get('/api/result/hongkong/:tipe', async (req, res) => {
    const { tipe } = req.params;
    const debug = req.query.debug === '1';

    if (tipe !== 'day' && tipe !== 'night') {
        return res.status(404).json({
            status: 'error',
            pesan: 'Tipe pasaran Hongkong tidak valid. Gunakan "day" atau "night".'
        });
    }

    const targetUrl = 'https://www.hkpools1.com/';
    const isoWib = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const cacheKey = `hkpools_${tipe}_${isoWib}`;

    const hit = getCache(cacheKey);

    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(hit, debug));
    }

    try {
        const html = await fetchWithAntiBlock(targetUrl);
        const $ = cheerio.load(html);

        const sectionIndex = tipe === 'day' ? 0 : 1;
        const container = $('.col-md-6').eq(sectionIndex);

        const rawDate = container.find('span.title-1:contains("DRAW DATE")')
            .text()
            .replace('DRAW DATE', '')
            .trim();

        const getBalls = (ballClass) => {
            return container.find(ballClass)
                .map((i, el) => $(el).text().trim())
                .get()
                .join('');
        };

        const prize1Full = getBalls('.ball-1');
        const prize2Full = getBalls('.ball-2');
        const prize3Full = getBalls('.ball-3');

        if (!prize1Full || prize1Full.includes('X')) {
            return res.status(200).json(bentukRespons({
                status: 'belum_update',
                pesan: `Data pasaran HONGKONG ${tipe.toUpperCase()} belum tersedia (masih diundi/XXXXXX).`
            }, debug));
        }

        // HANYA HK yang disisipkan properti p1, p2, p3
        const prize1 = prize1Full.slice(-4);
        const prize2 = prize2Full.slice(-4);
        const prize3 = prize3Full.slice(-4);

        const payload = {
            status: 'sukses',
            pasaran: `HONGKONG ${tipe.toUpperCase()}`,
            tanggal_wib: rawDate,
            angka_keluar: prize1,
            p1: prize1,
            p2: prize2,
            p3: prize3
        };

        setCache(cacheKey, payload);
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));

    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: 'Gagal mengakses website HK Pools.',
            detail: error.message,
            ...(debug ? { url: targetUrl } : {})
        });
    }
});

// ================= ENDPOINT TOTO MACAU PER JAM =================
app.get('/api/result/macau/:sesi', async (req, res) => {
    const { sesi } = req.params;
    const debug = req.query.debug === '1';

    let targetJam = '';

    if (/^\d{4}$/.test(sesi)) {
        targetJam = `${sesi.slice(0, 2)}:${sesi.slice(2, 4)}`;
    } else if (/^\d{2}:\d{2}$/.test(sesi)) {
        targetJam = sesi;
    } else {
        return res.status(404).json({
            status: 'error',
            pesan: 'Format sesi salah. Gunakan format: 1300, 1600, 1900, 2200, 2300, atau 0000.'
        });
    }

    const [jamAngka, menitAngka] = targetJam.split(':').map(Number);

    if (jamAngka > 23 || menitAngka > 59) {
        return res.status(404).json({
            status: 'error',
            pesan: 'Jam sesi tidak valid.'
        });
    }

    const targetUrl = 'https://www.totomacaupools.com/';

    const wibHariIni = partsInTZ(new Date(), 'Asia/Jakarta');
    const isoWib = iso(wibHariIni);
    const cacheKey = `macau_${targetJam}_${isoWib}`;

    const hit = getCache(cacheKey);

    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(hit, debug));
    }

    try {
        const html = await fetchWithAntiBlock(targetUrl);
        const $ = cheerio.load(html);

        let payload = null;
        let fallback = null;

        $('.resultWrapper .container').each((i, el) => {
            const judul = $(el)
                .find('.event span')
                .text()
                .toUpperCase();

            if (!judul.includes('4D')) return;

            const waktuRaw = $(el)
                .find('.calendar .time')
                .text()
                .trim();

            const waktuMatch = waktuRaw.match(/(\d{2}:\d{2})/);
            const jamWeb = waktuMatch ? waktuMatch[1] : '';

            const hari = $(el)
                .find('.calendar .day')
                .contents()
                .first()
                .text()
                .trim();

            const bulanStr = $(el)
                .find('.calendar .month')
                .contents()
                .first()
                .text()
                .trim()
                .toLowerCase()
                .replace(/\.$/, '');

            const tahun = $(el)
                .find('.calendar .year')
                .contents()
                .first()
                .text()
                .trim();

            const bulanAngka = MONTHS.indexOf(bulanStr) + 1;

            const tanggalUndian = `${hari} ${bulanStr.toUpperCase()} ${tahun}`;

            const isoWeb = (
                bulanAngka > 0 &&
                /^\d{1,2}$/.test(hari) &&
                /^\d{4}$/.test(tahun)
            )
                ? `${tahun}-${String(bulanAngka).padStart(2, '0')}-${String(Number(hari)).padStart(2, '0')}`
                : '';

            if (!tanggalValid(isoWeb)) return;

            const angkaKeluar = [];

            $(el).find('.results ul li').each((j, li) => {
                const style = ($(li).attr('style') || '').toLowerCase();

                if (style.includes('display:none') || style.includes('visibility:hidden')) {
                    return;
                }

                const imgSrc = $(li).find('img').attr('src') || '';
                const matchAngka = imgSrc.match(/ball-(\d+)\.png/i);

                if (matchAngka) {
                    angkaKeluar.push(matchAngka[1]);
                }
            });

            if (jamWeb === targetJam && isoWeb === isoWib) {
                if (angkaKeluar.length === 4) {
                    payload = {
                        status: 'sukses',
                        pasaran: `TOTO MACAU ${targetJam} WIB`,
                        tanggal_wib: tanggalUndian,
                        waktu_undian_wib: `${jamWeb} WIB`,
                        angka_keluar: angkaKeluar.join('') // USA/Macau tidak dikirim p1 di sini
                    };

                    return false;
                }

                if (!fallback) {
                    fallback = {
                        status: 'belum_update',
                        pesan: `Tanggal dan sesi cocok, tetapi jumlah angka yang ditemukan ${angkaKeluar.length}/4.`,
                        ...(debug ? {
                            req_jam: targetJam,
                            req_tgl: isoWib,
                            web_jam: jamWeb,
                            web_tgl: isoWeb,
                            angka_ditemukan: angkaKeluar
                        } : {})
                    };
                }

                return;
            }

            if (!fallback) {
                fallback = {
                    status: 'belum_update',
                    pesan: `Data putaran ${targetJam} untuk tanggal ${isoWib} belum tersedia. Web menampilkan hasil ${jamWeb || 'tanpa jam'} tanggal ${isoWeb}.`,
                    ...(debug ? {
                        req_jam: targetJam,
                        req_tgl: isoWib,
                        web_jam: jamWeb,
                        web_tgl: isoWeb
                    } : {})
                };
            }
        });

        if (!payload) {
            payload = fallback;
        }

        if (!payload) {
            return res.status(422).json({
                status: 'error',
                pesan: 'Gagal menemukan struktur 4D yang memiliki tanggal valid di halaman Toto Macau.',
                ...(debug ? { url: targetUrl } : {})
            });
        }

        if (payload.status === 'sukses') {
            setCache(cacheKey, payload);
        }

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: 'Gagal mengakses website Toto Macau.',
            detail: error.message,
            ...(debug ? {
                url: targetUrl,
                waktu: dapatkanWaktuWIB()
            } : {})
        });
    }
});

// ================= ENDPOINT HASIL (LOTTERY USA) =================
app.get('/api/result/:state/:game', async (req, res) => {
    const { state, game } = req.params;
    const debug = req.query.debug === '1';

    const tz = STATE_TZ[state];

    if (!tz || !/^[a-z0-9-]+$/.test(game)) {
        return res.status(404).json({
            status: 'error',
            pesan: 'State atau game tidak dikenal.'
        });
    }

    const targetGame = GAME_ALIAS[`${state}/${game}`] || game;
    const targetState = STATE_SLUG[state] || state;

    const targetUrl =
        `https://www.lotteryusa.com/${targetState}/${targetGame}/`;

    const cacheKey =
        `${state}/${game}/${iso(partsInTZ(new Date(), 'Asia/Jakarta'))}`;

    const hit = getCache(cacheKey);

    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(hit, debug));
    }

    const kunciLotre = `${state}/${game}`;

    if (NY_TIPE_INTERNAL[kunciLotre]) {
        try {
            const hasilNY = await ambilNewYorkResmi(kunciLotre);
            if (hasilNY) {
                const slotNY = SLOT_WIB[kunciLotre];
                const jamNY = JADWAL[kunciLotre];

                let waktuNY = slotNY ? slotWIB(hasilNY.tgl, tz, slotNY) : null;
                if (!waktuNY) {
                    const [hhNY, mmNY] = (jamNY || JAM_DEFAULT).split(':').map(Number);
                    waktuNY = localToDate(hasilNY.tgl.y, hasilNY.tgl.m, hasilNY.tgl.d, hhNY, mmNY, tz);
                }

                const wibUndianNY = iso(partsInTZ(waktuNY, 'Asia/Jakarta'));
                const wibHariIni = iso(partsInTZ(new Date(), 'Asia/Jakarta'));

                if (wibUndianNY === wibHariIni) {
                    const payloadNY = {
                        status: 'sukses',
                        pasaran: game === 'midday-win-4' ? 'MIDDAY WIN 4' : 'WIN 4',
                        tanggal_wib: getTanggalWIB(waktuNY),
                        waktu_undian_wib: jamWIB(waktuNY),
                        tanggal_undian_us: iso(hasilNY.tgl),
                        zona_undian: tz,
                        sumber: 'nylottery.ny.gov (API)',
                        angka_keluar: hasilNY.angka.join('')
                    };

                    setCache(cacheKey, payloadNY);
                    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
                    return res.json(bentukRespons(payloadNY, debug));
                }
            }
        } catch (errorNY) {}
    }

    if (FL_TIPE[`${state}/${game}`]) {
        try {
            const kunciFl = `${state}/${game}`;
            const hasilFl = await ambilFloridaResmi(kunciFl);

            if (hasilFl) {
                const slotFl = SLOT_WIB[kunciFl];
                const jamFl = JADWAL[kunciFl];

                let waktuFl = slotFl
                    ? slotWIB(hasilFl.tgl, tz, slotFl)
                    : null;

                if (!waktuFl) {
                    const [hhFl, mmFl] = (jamFl || JAM_DEFAULT)
                        .split(':')
                        .map(Number);

                    waktuFl = localToDate(
                        hasilFl.tgl.y,
                        hasilFl.tgl.m,
                        hasilFl.tgl.d,
                        hhFl,
                        mmFl,
                        tz
                    );
                }

                const wibUndianFl = iso(
                    partsInTZ(waktuFl, 'Asia/Jakarta')
                );

                const wibHariIniFl = iso(
                    partsInTZ(new Date(), 'Asia/Jakarta')
                );

                if (wibUndianFl === wibHariIniFl) {
                    const payloadFl = {
                        status: 'sukses',
                        pasaran: game === 'pick-4-midday'
                            ? 'MIDDAY PICK 4'
                            : 'PICK 4',
                        tanggal_wib: getTanggalWIB(waktuFl),
                        waktu_undian_wib: jamWIB(waktuFl),
                        tanggal_undian_us: iso(hasilFl.tgl),
                        zona_undian: tz,
                        sumber: 'floridalottery.com',
                        angka_keluar: hasilFl.angka.join('')
                    };

                    setCache(cacheKey, payloadFl);

                    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
                    return res.json(bentukRespons(payloadFl, debug));
                }
            }
        } catch (errorFl) {}
    }

    try {
        const html = await fetchWithAntiBlock(targetUrl);
        const $ = cheerio.load(html);

        let namaPasaran = $('h1').first().text()
            .replace(/winning numbers/i, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        if (!namaPasaran) {
            namaPasaran = `${state} ${game}`.toUpperCase();
        }

        const blok = $('.c-game-components').first().length
            ? $('.c-game-components').first()
            : $('main').first();

        const tzNow = partsInTZ(new Date(), tz);

        const bolaPertama = blok
            .find('[class*="ball"]')
            .filter((i, el) => !isFireball($, el))
            .filter((i, el) => /^\d$/.test($(el).text().trim()))
            .first();

        if (!bolaPertama.length) {
            return res.status(422).json({
                status: 'belum_update',
                pesan: 'Angka hasil tidak ditemukan pada HTML.',
                ...(debug ? {
                    url: targetUrl,
                    judul: $('title').text().trim(),
                    selector: '.c-game-components [class*="ball"]'
                } : {})
            });
        }

        const wadahAngka = cariWadahAngka($, bolaPertama);

        let tglRaw = cariTanggalRaw($, wadahAngka);

        if (!tglRaw) {
            tglRaw = cariTanggalRaw($, bolaPertama.parent());
        }

        const tglUndian = parseTanggal(tglRaw, tzNow);

        if (!tglUndian) {
            return res.status(422).json({
                status: 'error',
                pesan: 'Tanggal undian tidak ditemukan atau formatnya tidak dikenali.',
                ...(debug ? {
                    detail: (tglRaw || '').slice(0, 200),
                    url: targetUrl,
                    judul: $('title').text().trim()
                } : {})
            });
        }

        if (iso(tglUndian) > iso(tzNow)) {
            return res.json({
                status: 'belum_update',
                pesan:
                    `Tanggal hasil web ${iso(tglUndian)} lebih baru daripada tanggal lokal ${iso(tzNow)} di ${tz}.`,
                ...(debug ? {
                    url: targetUrl,
                    tanggal_web: iso(tglUndian),
                    tanggal_lokal: iso(tzNow)
                } : {})
            });
        }

        const kunci = `${state}/${game}`;
        const slot = SLOT_WIB[kunci];
        const jam = JADWAL[kunci];

        let waktuUndian = slot
            ? slotWIB(tglUndian, tz, slot)
            : null;

        if (!waktuUndian) {
            const [hh, mm] = (jam || JAM_DEFAULT)
                .split(':')
                .map(Number);

            waktuUndian = localToDate(
                tglUndian.y,
                tglUndian.m,
                tglUndian.d,
                hh,
                mm,
                tz
            );
        }

        const wibUndian = iso(
            partsInTZ(waktuUndian, 'Asia/Jakarta')
        );

        const wibHariIni = iso(
            partsInTZ(new Date(), 'Asia/Jakarta')
        );

        if (wibUndian !== wibHariIni) {
            return res.json({
                status: 'belum_update',
                pesan:
                    `Tanggal hasil WIB (${wibUndian}) berbeda dari tanggal WIB hari ini (${wibHariIni}).`,
                ...(debug ? {
                    url: targetUrl,
                    tanggal_undian_us: iso(tglUndian),
                    tanggal_undian_wib: wibUndian,
                    tanggal_hari_ini_wib: wibHariIni,
                    slot_wib: slot || null,
                    jadwal_lokal: jam || JAM_DEFAULT
                } : {})
            });
        }

        let angka = ambilAngka($, wadahAngka);

        if (angka.length !== 4) {
            let wadah = wadahAngka.parent();

            for (let i = 0; i < 5 && wadah.length; i++) {
                const kandidat = ambilAngka($, wadah);

                if (kandidat.length >= 4) {
                    angka = kandidat.slice(0, 4);
                    break;
                }

                wadah = wadah.parent();
            }
        }

        angka = angka.slice(0, 4);

        if (angka.length !== 4) {
            return res.status(422).json({
                status: 'belum_update',
                pesan: `Angka belum lengkap (${angka.length}/4).`,
                ...(debug ? {
                    url: targetUrl,
                    tanggal_dibaca: tglRaw,
                    angka_ditemukan: angka
                } : {})
            });
        }

        const tglWib = getTanggalWIB(waktuUndian);
        const waktuWib = (slot || jam)
            ? jamWIB(waktuUndian)
            : null;

        const payload = {
            status: 'sukses',
            pasaran: namaPasaran,
            tanggal_wib: tglWib,
            waktu_undian_wib: waktuWib,
            tanggal_undian_us: iso(tglUndian),
            zona_undian: tz,
            angka_keluar: angka.join('') // TIDAK ADA p1 
        };

        setCache(cacheKey, payload);

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: 'Gagal mengambil data dari target.',
            detail: error.message,
            ...(debug ? {
                url: targetUrl,
                waktu: dapatkanWaktuWIB()
            } : {})
        });
    }
});

// ================= PASARAN UTAMA =================
app.get('/api/markets', async (req, res) => {
    const cacheKey = 'usa_markets';

    const hit = getCache(cacheKey);

    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(hit);
    }

    try {
        const html = await fetchWithAntiBlock(
            'https://www.lotteryusa.com/'
        );

        const $ = cheerio.load(html);
        const markets = [];

        const bukanLotre = [
            'PLAY',
            'Play online',
            'Daily game stats',
            'On this day'
        ];

        $('h3').each((i, element) => {
            const nama = $(element).text().trim();

            if (
                !nama ||
                bukanLotre.includes(nama) ||
                nama.includes('?') ||
                nama.length > 25
            ) {
                return;
            }

            let parent = $(element).parent();
            let angka = [];
            let tanggal = 'Belum diundi';
            let jackpot = 'N/A';

            for (let level = 0; level < 5; level++) {
                parent.find('[class*="ball"]').each((j, b) => {
                    if (isFireball($, b)) return;

                    const t = $(b).text().trim();

                    if (t && t.length <= 3) {
                        angka.push(t);
                    }
                });

                if (angka.length > 0) {
                    const elemenTanggal = parent
                        .find('time, [class*="date"]')
                        .first();

                    tanggal =
                        elemenTanggal.attr('datetime') ||
                        elemenTanggal.text().trim() ||
                        tanggal;

                    parent.find(
                        '[class*="jackpot"], [class*="prize"]'
                    ).each((j, jp) => {
                        const t = $(jp).text().trim();

                        if (t.includes('$')) {
                            jackpot = t.replace(/\s+/g, ' ');
                        }
                    });

                    break;
                }

                parent = parent.parent();
            }

            if (angka.length > 0) {
                markets.push({
                    pasaran: nama,
                    tanggal_undian: tanggal,
                    jackpot,
                    angka_keluar: angka
                });
            }
        });

        const payload = {
            status: 'sukses',
            waktu_update_wib: dapatkanWaktuWIB(),
            total_pasaran: markets.length,
            data: markets
        };

        setCache(cacheKey, payload);

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(payload);
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: error.message
        });
    }
});

// ================= SETUP SERVER / EXPORT =================

if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
    });
}

module.exports = app;
