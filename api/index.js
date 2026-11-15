const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const https = require('https');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());

const insecureHttpsAgent = new https.Agent({
    rejectUnauthorized: false
});

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

function getWIBCompactDate(waktu = new Date()) {
    const { y, m, d } = partsInTZ(waktu, 'Asia/Jakarta');
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

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

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Validasi tanggal WIB hari ini pada teks HTML / JSON.
function isWIBTodayValid(content) {
    const { y: year, m: month, d: day } = partsInTZ(new Date(), 'Asia/Jakarta');

    const dayNoZero = String(day);
    const dayTwo = String(day).padStart(2, '0');
    const monthNoZero = String(month);
    const monthTwo = String(month).padStart(2, '0');
    const shortYear = String(year).slice(-2);

    const monthNamesId = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthNamesEn = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const id = monthNamesId[month - 1];
    const en = monthNamesEn[month - 1];
    const idShort = id.slice(0, 3);
    const enShort = en.slice(0, 3);

    const sep = '[-/.,\\s]+';
    const b = '(?<!\\d)';
    const eb = '(?!\\d)';

    const patterns = [
        `${b}0?${dayNoZero}${sep}0?${monthNoZero}${sep}${year}${eb}`,
        `${b}${year}${sep}0?${monthNoZero}${sep}0?${dayNoZero}${eb}`,
        `${b}0?${monthNoZero}${sep}0?${dayNoZero}${sep}${year}${eb}`,
        `${b}0?${dayNoZero}${sep}0?${monthNoZero}${sep}${shortYear}${eb}`,
        `${b}0?${monthNoZero}${sep}0?${dayNoZero}${sep}${shortYear}${eb}`,
        `${b}${shortYear}${sep}0?${monthNoZero}${sep}0?${dayNoZero}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(id)}${sep}${year}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(idShort)}${sep}${year}${eb}`,
        `${b}${escapeRegex(id)}${sep}0?${dayNoZero}${sep}${year}${eb}`,
        `${b}${escapeRegex(idShort)}${sep}0?${dayNoZero}${sep}${year}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(en)}${sep}${year}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(enShort)}${sep}${year}${eb}`,
        `${b}${escapeRegex(en)}${sep}0?${dayNoZero}${sep}${year}${eb}`,
        `${b}${escapeRegex(enShort)}${sep}0?${dayNoZero}${sep}${year}${eb}`,
        `${b}${dayTwo}${monthTwo}${year}${eb}`,
        `${b}${year}${monthTwo}${dayTwo}${eb}`,
        `${b}${dayTwo}${escapeRegex(enShort)}${year}${eb}`,
        `${b}${dayTwo}${escapeRegex(idShort)}${year}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(id)}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(idShort)}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(en)}${eb}`,
        `${b}0?${dayNoZero}${sep}${escapeRegex(enShort)}${eb}`,
        `${b}${escapeRegex(en)}${sep}0?${dayNoZero}${eb}`,
        `${b}${escapeRegex(enShort)}${sep}0?${dayNoZero}${eb}`
    ];

    const text = String(content || '');
    return patterns.some(p => new RegExp(p, 'i').test(text));
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

// ================= JADWAL UNDIAN USA =================
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

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

function getRandomHeaders(targetUrl = '') {
    const headers = {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    };

    if (targetUrl.includes('livedrawhijau.org')) {
        try {
            const pathSeg = new URL(targetUrl).pathname.split('/')[1];
            headers['X-Requested-With'] = 'XMLHttpRequest';
            headers['Referer'] = `https://livedrawhijau.org/${pathSeg}/`;
            headers['Accept'] = 'application/json, text/javascript, */*; q=0.01';
        } catch (e) {
            // abaikan
        }
    } else if (targetUrl) {
        headers['Referer'] = targetUrl;
    }

    return headers;
}

const diblokCF = data => {
    if (typeof data !== 'string') return false;

    const lower = data.toLowerCase();

    return (
        lower.includes('just a moment...') ||
        lower.includes('attention required') ||
        lower.includes('cf-chl-') ||
        lower.includes('cloudflare ray id')
    );
};

async function ambil(url, signal = null) {
    const headers = getRandomHeaders(url);

    const res = await axios.get(url, {
        headers,
        timeout: 7500,
        responseType: 'text',
        maxRedirects: 5,
        httpsAgent: insecureHttpsAgent,
        signal,
        validateStatus: status => status >= 200 && status < 400
    });

    if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
    }

    if (diblokCF(res.data)) {
        throw new Error('Halaman ditolak atau menampilkan challenge Cloudflare.');
    }

    if (!res.data || (typeof res.data === 'string' && res.data.trim().length < 5)) {
        throw new Error('Respons kosong atau terlalu pendek.');
    }

    return res.data;
}

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

// ================= SUMBER RESMI NEW YORK =================
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
const OK_TTL_MS = 3 * 60 * 1000;
const CACHE_MAX_ENTRIES = 250;

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

function bentukRespons(full, debug) {
    if (debug) return full;

    const {
        status,
        pasaran,
        tanggal_wib,
        angka_keluar,
        p1,
        p2,
        p3,
        pesan
    } = full;

    if (status === 'belum_update') {
        return {
            status,
            ...(pasaran ? { pasaran } : {}),
            pesan: pesan || 'Hasil hari ini belum update.'
        };
    }

    if (p1 !== undefined && p1 !== null) {
        return {
            status,
            pasaran,
            tanggal: tanggal_wib,
            tanggal_wib,
            angka_keluar: angka_keluar || p1,
            p1,
            ...(p2 ? { p2 } : {}),
            ...(p3 ? { p3 } : {})
        };
    }

    return {
        status,
        pasaran,
        tanggal: tanggal_wib,
        tanggal_wib,
        angka_keluar
    };
}

// ================= HELPER PARSER LOTTERYUSA =================
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

// ================= HELPER HK POOLS =================
const HKPOOLS_URL = 'https://hkpools1.com/';

const HKPOOLS_LABEL = {
    day: 'HONGKONG DAY',
    night: 'HONGKONG NIGHT'
};

const BULAN_INGGRIS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

function formatTanggalHkPools(tanggal) {
    if (!tanggal) return null;

    const match = String(tanggal).match(
        /^(\d{1,2})-(\d{1,2})-(\d{4})$/
    );

    if (!match) return null;

    const hari = Number(match[1]);
    const bulan = Number(match[2]);
    const tahun = Number(match[3]);

    const date = new Date(Date.UTC(tahun, bulan - 1, hari));

    if (
        date.getUTCFullYear() !== tahun ||
        date.getUTCMonth() !== bulan - 1 ||
        date.getUTCDate() !== hari
    ) {
        return null;
    }

    return `${String(hari).padStart(2, '0')} ${BULAN_INGGRIS[bulan - 1]} ${tahun}`;
}

function cariBagianHkPools($, market) {
    const namaTarget = market === 'day'
        ? 'HKPOOLS DAY'
        : 'HKPOOLS NIGHT';

    const kolom = $('.col-md-6').filter(function () {
        const teks = $(this)
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        return (
            teks.includes(namaTarget) &&
            /DRAW\s*DATE/i.test(teks) &&
            /1ST\s*PRIZE/i.test(teks) &&
            /2ND\s*PRIZE/i.test(teks) &&
            /3RD\s*PRIZE/i.test(teks)
        );
    }).first();

    if (kolom.length) return kolom;

    let judul = null;

    $('b').each((_, el) => {
        const teks = $(el)
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        if (teks === namaTarget) {
            judul = $(el);
            return false;
        }
    });

    if (!judul || !judul.length) return null;

    let parent = judul.parent();

    for (let i = 0; i < 10 && parent.length; i++) {
        const teks = parent.text().replace(/\s+/g, ' ');

        if (
            /DRAW\s*DATE/i.test(teks) &&
            /1ST\s*PRIZE/i.test(teks) &&
            /2ND\s*PRIZE/i.test(teks) &&
            /3RD\s*PRIZE/i.test(teks)
        ) {
            return parent;
        }

        parent = parent.parent();
    }

    return null;
}

function ambilTanggalHkPools($, bagian) {
    const teks = bagian.text().replace(/\s+/g, ' ').trim();

    const match = teks.match(
        /DRAW\s*DATE\s*:?\s*(\d{1,2}-\d{1,2}-\d{4})/i
    );

    return match ? match[1] : null;
}

function ambilNomorEnamDigitHkPools($, row) {
    const bola = row.find(
        'span.ball-1, span.ball-2, span.ball-3'
    );

    if (bola.length === 6) {
        let nomor = '';
        let valid = true;

        bola.each((_, el) => {
            const digit = $(el).text().trim();

            if (!/^\d$/.test(digit)) {
                valid = false;
                return false;
            }

            nomor += digit;
        });

        if (valid && /^\d{6}$/.test(nomor)) {
            return nomor;
        }

        return null;
    }

    const teks = row.find('td').last().text().replace(/\s+/g, ' ').trim();
    const digit = teks.replace(/\D/g, '');

    return /^\d{6}$/.test(digit) ? digit : null;
}

function ambilHadiahHkPools($, bagian, label) {
    let hasil = null;

    bagian.find('tr').each((_, el) => {
        if (hasil !== null) return false;

        const row = $(el);

        const labelTeks = row.find('td').first()
            .text()
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();

        if (labelTeks !== label.toUpperCase()) return;

        const nomor = ambilNomorEnamDigitHkPools($, row);

        if (nomor && /^\d{6}$/.test(nomor)) {
            hasil = nomor.slice(-4);
            return false;
        }
    });

    return hasil;
}

function parseHkPools(html, market) {
    const $ = cheerio.load(html);

    const bagian = cariBagianHkPools($, market);

    if (!bagian || !bagian.length) {
        throw new Error(
            `Bagian ${HKPOOLS_LABEL[market]} tidak ditemukan pada HTML sumber.`
        );
    }

    const tanggalRaw = ambilTanggalHkPools($, bagian);
    const tanggalWib = formatTanggalHkPools(tanggalRaw);

    const p1 = ambilHadiahHkPools($, bagian, '1ST PRIZE');
    const p2 = ambilHadiahHkPools($, bagian, '2ND PRIZE');
    const p3 = ambilHadiahHkPools($, bagian, '3RD PRIZE');

    return {
        status: 'sukses',
        pasaran: HKPOOLS_LABEL[market],
        tanggal_wib: tanggalWib,
        angka_keluar: p1,
        p1,
        p2,
        p3
    };
}

// ================= NEW ZEALAND BULLSEYE =================

const BULLSEYE_API =
    'https://pathway.mylotto.co.nz/api/results/v1/results/bullseye';

const BULLSEYE_TZ = 'Pacific/Auckland';
const BULLSEYE_CACHE_TTL = 60 * 1000;

let bullseyeCache = null;
let bullseyeCacheTime = 0;
let bullseyeInFlight = null;

function getBullseyeHeaders() {
    return {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': USER_AGENTS[
            Math.floor(Math.random() * USER_AGENTS.length)
        ],
        'Origin': 'https://mylotto.co.nz',
        'Referer': 'https://mylotto.co.nz/',
        'LNZ-CHANNEL': 'web',
        'LNZ-APPLICATION-VERSION': '39.0.0',
        'LNZ-REQUEST-ID': randomUUID()
    };
}

function validasiBullseye(drawDate, drawTime, waktuUndian) {
    if (!tanggalValid(drawDate)) {
        throw new Error('Tanggal undian Bullseye tidak valid.');
    }

    if (!(waktuUndian instanceof Date) || isNaN(waktuUndian.getTime())) {
        throw new Error('Waktu undian Bullseye tidak valid.');
    }

    const match = /^(\d{1,2}):(\d{2})$/.exec(drawTime);

    if (!match) {
        throw new Error('Format waktu undian Bullseye tidak dikenali.');
    }

    const jam = Number(match[1]);
    const menit = Number(match[2]);
    const totalMenit = jam * 60 + menit;

    if (jam > 23 || menit > 59) {
        throw new Error('Jam undian Bullseye tidak valid.');
    }

    if (
        totalMenit < 17 * 60 + 55 ||
        totalMenit > 18 * 60 + 15
    ) {
        throw new Error(
            'Waktu undian tidak sesuai jadwal Bullseye.'
        );
    }

    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: BULLSEYE_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });

    const parts = Object.fromEntries(
        formatter.formatToParts(new Date()).map(p => [
            p.type,
            p.value
        ])
    );

    const sekarangMenit =
        Number(parts.hour) * 60 + Number(parts.minute);

    const tanggalSekarang =
        `${parts.year}-${parts.month}-${parts.day}`;

    const hariIni = new Date(Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day)
    ));

    const kemarin = new Date(hariIni);
    kemarin.setUTCDate(kemarin.getUTCDate() - 1);

    const tanggalKemarin = [
        kemarin.getUTCFullYear(),
        String(kemarin.getUTCMonth() + 1).padStart(2, '0'),
        String(kemarin.getUTCDate()).padStart(2, '0')
    ].join('-');

    if (sekarangMenit < 18 * 60) {
        if (drawDate !== tanggalKemarin) {
            throw new Error(
                'Tanggal hasil Bullseye tidak sesuai jadwal.'
            );
        }
    } else if (sekarangMenit > 18 * 60 + 15) {
        if (drawDate !== tanggalSekarang) {
            throw new Error(
                'Hasil Bullseye masih menggunakan tanggal lama.'
            );
        }
    } else {
        if (
            drawDate !== tanggalSekarang &&
            drawDate !== tanggalKemarin
        ) {
            throw new Error(
                'Tanggal hasil Bullseye tidak valid.'
            );
        }
    }

    if (waktuUndian.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new Error(
            'Waktu undian Bullseye berada di masa depan.'
        );
    }

    return true;
}

async function ambilBullseye() {
    if (
        bullseyeCache &&
        Date.now() - bullseyeCacheTime < BULLSEYE_CACHE_TTL
    ) {
        return bullseyeCache;
    }

    if (bullseyeInFlight) {
        return bullseyeInFlight;
    }

    bullseyeInFlight = (async () => {
        try {
            const response = await axios.get(BULLSEYE_API, {
                headers: getBullseyeHeaders(),
                timeout: 8000,
                params: {
                    _: Date.now()
                }
            });

            const raw = response.data;

            if (!raw || typeof raw !== 'object') {
                throw new Error(
                    'Respons Bullseye bukan JSON yang valid.'
                );
            }

            const angkaEnamDigit = String(
                raw.bullseyeWinningNumbers?.numbers ?? ''
            );

            if (!/^\d{6}$/.test(angkaEnamDigit)) {
                throw new Error(
                    'Angka Bullseye tidak ditemukan atau bukan enam digit.'
                );
            }

            const drawDate = String(raw.drawDate || '');
            const drawTime = String(raw.drawTime || '');

            const tanggalMatch = drawDate.match(
                /^(\d{4})-(\d{2})-(\d{2})/
            );

            const waktuMatch = drawTime.match(
                /^(\d{1,2}):(\d{2})$/
            );

            if (!tanggalMatch || !waktuMatch) {
                throw new Error(
                    'Format tanggal atau waktu undian Bullseye tidak dikenali.'
                );
            }

            const tahun = Number(tanggalMatch[1]);
            const bulan = Number(tanggalMatch[2]);
            const hari = Number(tanggalMatch[3]);
            const jam = Number(waktuMatch[1]);
            const menit = Number(waktuMatch[2]);

            const tanggalISO =
                `${tahun}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;

            if (!tanggalValid(tanggalISO)) {
                throw new Error(
                    'Tanggal kalender Bullseye tidak valid.'
                );
            }

            if (jam > 23 || menit > 59) {
                throw new Error(
                    'Jam undian Bullseye tidak valid.'
                );
            }

            const waktuUndian = localToDate(
                tahun,
                bulan,
                hari,
                jam,
                menit,
                BULLSEYE_TZ
            );

            validasiBullseye(
                tanggalISO,
                drawTime,
                waktuUndian
            );

            const payload = {
                status: 'sukses',
                pasaran: 'NEW ZEALAND BULLSEYE',
                tanggal_wib: getTanggalWIB(waktuUndian),
                waktu_undian_wib: jamWIB(waktuUndian),
                tanggal_undian_nz: tanggalISO,
                zona_undian: BULLSEYE_TZ,
                draw_number: raw.drawNumber ?? null,
                angka_keluar: angkaEnamDigit.slice(-4)
            };

            bullseyeCache = payload;
            bullseyeCacheTime = Date.now();

            return payload;

        } finally {
            bullseyeInFlight = null;
        }
    })();

    return bullseyeInFlight;
}

// =====================================================================
// UNIVERSAL SCRAPER ENGINE UNTUK PASARAN ASIA & TOGEL (DARI FILE BOT)
// =====================================================================

// Mendukung selector standar CSS maupun jQuery-style ':eq(N)' di Cheerio
function queryCheerio($, selector) {
    if (!selector) return $();
    const eqMatch = String(selector).match(/^(.*?):eq\((\d+)\)\s*(.*)$/);
    if (eqMatch) {
        const [, before, idx, after] = eqMatch;
        const base = $(before.trim()).eq(Number(idx));
        return after && after.trim() ? base.find(after.trim()) : base;
    }
    return $(selector);
}

function cleanFourDigits(val) {
    if (val === null || val === undefined) return null;
    const digits = String(val).replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

function extractImageBalls($, selector) {
    let numStr = '';
    queryCheerio($, selector)
        .first()
        .find('img')
        .each((_, el) => {
            const src = $(el).attr('src') || '';
            const match = src.match(/_(\d)\.jpg/i);
            if (match) {
                numStr += match[1];
            }
        });
    return numStr || null;
}

function parseSG4DHistoryJson(jsonData, requestedDate) {
    const drawList = jsonData?.result?.draw4d;
    if (!Array.isArray(drawList) || drawList.length === 0) {
        throw new Error('SG4D History: data draw4d kosong.');
    }

    const draw = drawList.find(
        item => String(item?.date || '') === String(requestedDate)
    );

    if (!draw) {
        throw new Error(`SG4D belum update (Diminta: ${requestedDate})`);
    }

    const prizeRows = Array.isArray(draw.n) ? draw.n : [];
    const findPrize = pos => {
        const item = prizeRows.find(
            row => String(row?.p || '').toUpperCase() === pos
        );
        return item?.i != null ? String(item.i) : null;
    };

    const p1 = cleanFourDigits(findPrize('T1'));
    const p2 = cleanFourDigits(findPrize('T2'));
    const p3 = cleanFourDigits(findPrize('T3'));

    if (!p1 || !p2 || !p3) {
        throw new Error('SG4D History: T1/T2/T3 belum lengkap.');
    }

    return {
        p1,
        p2,
        p3,
        drawDate: draw.date
    };
}

// Konfigurasi seluruh sumber scraping per endpoint slug
const ASIAN_MARKETS = {
    'cambodia': {
        pasaran: 'CAMBODIA',
        sources: [
            {
                url: 'https://www.magnumcambodia.com',
                isImageBall: true,
                prizeSelectors: {
                    p1: "table[bordercolor='#EEEEEE'] tr:first-child td:nth-child(1)",
                    p2: "table[bordercolor='#EEEEEE'] tr:first-child td:nth-child(2)",
                    p3: "table[bordercolor='#EEEEEE'] tr:first-child td:nth-child(3)"
                }
            }
        ]
    },
    'sydney-pools': {
        pasaran: 'SYDNEY POOLS',
        sources: [
            {
                url: 'https://livedrawnorthcarolinaday.wiki/livedraw/sydney.php',
                prizeSelectors: {
                    p1: 'tr:nth-child(2) td.warnaisi',
                    p2: 'tr:nth-child(3) td.warnaisi',
                    p3: 'tr:nth-child(4) td.warnaisi'
                }
            },
            {
                url: 'https://livedraw.online/sydney/',
                prizeSelectors: {
                    p1: '.table.text-center tr:nth-child(1) td:nth-child(2) span',
                    p2: '.table.text-center tr:nth-child(2) td:nth-child(2) span',
                    p3: '.table.text-center tr:nth-child(3) td:nth-child(2) span'
                }
            },
            {
                url: 'https://www.sydneypoolstoday.com/',
                isImageBall: true,
                prizeSelectors: {
                    p1: 'table.sample:eq(0) tr:nth-child(1) td:nth-child(2)',
                    p2: 'table.sample:eq(0) tr:nth-child(3) td:nth-child(2)',
                    p3: 'table.sample:eq(0) tr:nth-child(5) td:nth-child(2)'
                }
            },
            {
                url: 'https://rankcrack.com/sdy.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(4) td.box-value a',
                    p2: 'tr:nth-of-type(5) td.box-value span',
                    p3: 'tr:nth-of-type(6) td.box-value span'
                }
            }
        ]
    },
    'sydney-lotto': {
        pasaran: 'SYDNEY LOTTO',
        sources: [
            {
                url: 'https://sydneylotto.com/positionPlace',
                joinAll: true
            },
            {
                url: 'https://rankcrack.com/sdylotto.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(4) td.box-value a',
                    p2: 'tr:nth-of-type(6) td.box-value span',
                    p3: 'tr:nth-of-type(7) td.box-value span'
                }
            }
        ]
    },
    'china': {
        pasaran: 'CHINA',
        sources: [
            {
                url: 'https://www.chinapools.asia/apps/home-left',
                prizeSelectors: {
                    p1: '#table_home_1 tr:nth-child(1) td.td2_home1',
                    p2: '#table_home_1 tr:nth-child(2) td.td2_home1',
                    p3: '#table_home_1 tr:nth-child(3) td.td2_home1'
                }
            },
            {
                url: 'https://livedrawchina.store/',
                prizeSelectors: {
                    p1: '.ld-prize:eq(0) .ld-balls',
                    p2: '.ld-prize:eq(1) .ld-balls',
                    p3: '.ld-prize:eq(2) .ld-balls'
                }
            }
        ]
    },
    'japan': {
        pasaran: 'JAPAN',
        sources: [
            {
                url: 'https://www.japanpools.online/',
                selector: '.win-number .circle',
                joinAll: true
            }
        ]
    },
    'singapore-toto': {
        pasaran: 'SINGAPORE TOTO',
        sources: [
            {
                url: 'https://livedraw.online/singapore-toto/',
                selector: 'h3 span.text-gold'
            },
            {
                url: 'https://livedrawhijau.org/singaporetoto/update_sgptoto'
            },
            {
                url: 'https://www.resultlivedrawsgp.com/live-draw-toto',
                selector: '.bg-blue-700 .rounded-full span'
            },
            {
                url: 'https://rankcrack.com/toto.php',
                selector: '.entry-ld-body tr:nth-child(6) a'
            }
        ]
    },
    'singapore-4d': {
        pasaran: 'SINGAPORE 4D',
        sources: [
            {
                url: 'https://livedraw.online/singapore/',
                prizeSelectors: {
                    p1: '.result-winner',
                    p2: 'tr:nth-child(2) .result-sub-winner',
                    p3: 'tr:nth-child(3) .result-sub-winner'
                }
            },
            {
                url: 'https://livedrawhijau.org/singaporepools/update_sgp_pools'
            },
            {
                url: 'https://www.singaporepools.com.sg/DataFileArchive/Lottery/Output/fourd_result_top_draws_en.html',
                prizeSelectors: {
                    p1: 'td.tdFirstPrize',
                    p2: 'td.tdSecondPrize',
                    p3: 'td.tdThirdPrize'
                }
            },
            {
                url: 'http://alpha4.live4d.sg/api/sg4d/history?ver=5.9.20&muid=1c98766488857238&did=10876903&ide=android&cdt=202611181850&rdt=20261010&ann=206&sec=1455c8',
                type: 'sg4d-history'
            },
            {
                url: 'https://rankcrack.com/sgp.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(4) td.box-value',
                    p2: 'tr:nth-of-type(5) td.box-value',
                    p3: 'tr:nth-of-type(6) td.box-value'
                }
            }
        ]
    },
    'magnum-4d': {
        pasaran: 'MAGNUM 4D',
        sources: [
            {
                url: 'https://togel-online.cc/livedraw/magnum4d',
                selector: 'p.text-gold'
            },
            {
                url: 'https://magnum4d.my/en/results',
                selector: '#fprize'
            }
        ]
    },
    'pcso': {
        pasaran: 'PCSO',
        sources: [
            {
                url: 'https://togel-online.cc/livedraw/pcso',
                selector: 'p.text-gold'
            },
            {
                url: 'https://rankcrack.com/pcso.php',
                selector: 'td.box-value a'
            }
        ]
    },
    'taiwan': {
        pasaran: 'TAIWAN',
        sources: [
            {
                url: 'https://livedrawhijau.org/taiwan/update_taiwan'
            },
            {
                url: 'https://www.pewaristotoprediksi.com/api/market-latest?market=taiwan'
            },
            {
                url: 'https://159.89.203.33/live-draw/taiwan/proxy_taiwan.php'
            },
            {
                url: 'https://rankcrack.com/tw.php',
                selector: 'td.box-value'
            },
            {
                url: 'https://masterpeace-sendai.com/',
                prizeSelectors: {
                    p1: '.ld-prize:eq(0) .ld-balls',
                    p2: '.ld-prize:eq(1) .ld-balls',
                    p3: '.ld-prize:eq(3) .ld-balls'
                }
            }
        ]
    },
    'taipei': {
        pasaran: 'TAIPEI',
        sources: [
            {
                url: 'https://togel-online.cc/livedraw/taipei',
                selector: 'p.text-gold'
            }
        ]
    },
    'hongkong': {
        pasaran: 'HONGKONG',
        sources: [
            {
                url: 'https://live.angka.live/livedrawhk/'
            },
            {
                url: 'https://live-hongkong.blogspot.com/',
                prizeSelectors: {
                    p1: '#mydiv3',
                    p2: '#mydiv4',
                    p3: '#mydiv5'
                }
            },
            {
                url: 'https://livedraw.online/hongkong/',
                prizeSelectors: {
                    p1: '.table.text-center tr:nth-child(1) td:nth-child(2) span',
                    p2: '.table.text-center tr:nth-child(2) td:nth-child(2) span',
                    p3: '.table.text-center tr:nth-child(3) td:nth-child(2) span'
                }
            },
            {
                url: 'https://hongkonglivedraw.biz/live-draw-hk/hk.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(3) td.box-value',
                    p2: 'tr:nth-of-type(4) td.box-value',
                    p3: 'tr:nth-of-type(5) td.box-value'
                }
            },
            {
                url: 'https://rankcrack.com/hk.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(4) td.box-value',
                    p2: 'tr:nth-of-type(5) td.box-value',
                    p3: 'tr:nth-of-type(6) td.box-value'
                }
            }
        ]
    },
    'hongkong-lotto': {
        pasaran: 'HONGKONG LOTTO',
        sources: [
            {
                url: 'https://hongkonglotto.com/positionPlace',
                joinAll: true
            },
            {
                url: 'https://livedraw.online/hongkong-lotto/',
                prizeSelectors: {
                    p1: '.table.text-center tr:nth-child(1) td:nth-child(2) span',
                    p2: '.table.text-center tr:nth-child(2) td:nth-child(2) span',
                    p3: '.table.text-center tr:nth-child(3) td:nth-child(2) span'
                }
            },
            {
                url: 'https://68.183.227.182/live-draw-togel/hk-live.php',
                prizeSelectors: {
                    p1: '.entry-ld-body tr:nth-of-type(1) td:nth-child(2)',
                    p2: '.entry-ld-body tr:nth-of-type(2) td:nth-child(2)',
                    p3: '.entry-ld-body tr:nth-of-type(3) td:nth-child(2)'
                }
            },
            {
                url: 'https://rankcrack.com/hklotto.php',
                prizeSelectors: {
                    p1: 'tr:nth-of-type(4) td.box-value a',
                    p2: 'tr:nth-of-type(6) td.box-value span',
                    p3: 'tr:nth-of-type(7) td.box-value span'
                }
            }
        ]
    }
};

async function scrapeSingleAsianSource(marketName, src, signal) {
    let requestUrl = src.url;

    if (src.type === 'sg4d-history') {
        const sep = requestUrl.includes('?') ? '&' : '?';
        requestUrl = `${requestUrl}${sep}d=${getWIBCompactDate()}`;
    }

    const cacheBuster = requestUrl.includes('?') ? '&' : '?';
    const rawBody = await ambil(`${requestUrl}${cacheBuster}_=${Date.now()}`, signal);

    let jsonData = null;

    if (typeof rawBody === 'string') {
        let trimmed = rawBody.trim();
        if (trimmed.startsWith('<')) {
            const $pre = cheerio.load(trimmed);
            const preText = $pre('pre').text().trim();
            if (preText.startsWith('{') || preText.startsWith('[')) {
                trimmed = preText;
            }
        }
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                jsonData = JSON.parse(trimmed);
            } catch (e) {
                jsonData = null;
            }
        }
    } else if (typeof rawBody === 'object' && rawBody !== null) {
        jsonData = rawBody;
    }

    let p1Raw = null;
    let p2Raw = null;
    let p3Raw = null;
    let dateVerified = false;

    if (jsonData) {
        const jsonStr = JSON.stringify(jsonData);

        if (src.type === 'sg4d-history') {
            const parsed = parseSG4DHistoryJson(jsonData, getWIBCompactDate());
            p1Raw = parsed.p1;
            p2Raw = parsed.p2;
            p3Raw = parsed.p3;
            dateVerified = true;
        } else if (Array.isArray(jsonData) && jsonData[0]?.prize1) {
            // Format livedrawhijau.org (Taiwan, SGP Pools, SGP Toto)
            const d = jsonData[0];
            p1Raw = d.prize1;
            if (d.prize2) p2Raw = d.prize2;
            if (d.prize3) p3Raw = d.prize3;
            dateVerified = isWIBTodayValid(d.tanggal || jsonStr);
        } else if (jsonData.Special_Prize || Array.isArray(jsonData.Grand_Prize)) {
            const main = jsonData.Special_Prize || jsonData.Grand_Prize;
            p1Raw = Array.isArray(main) ? main.join('') : String(main);
            if (jsonData.Grand_Prize && jsonData.Special_Prize) {
                p2Raw = Array.isArray(jsonData.Grand_Prize)
                    ? jsonData.Grand_Prize.join('')
                    : String(jsonData.Grand_Prize);
            } else if (jsonData.Second_Prize) {
                p2Raw = Array.isArray(jsonData.Second_Prize)
                    ? jsonData.Second_Prize.join('')
                    : String(jsonData.Second_Prize);
            }
            if (jsonData.Third_Prize) {
                p3Raw = Array.isArray(jsonData.Third_Prize)
                    ? jsonData.Third_Prize.join('')
                    : String(jsonData.Third_Prize);
            }
            dateVerified = isWIBTodayValid(
                jsonData.draw_date || jsonData.date || jsonData.tanggal || jsonStr
            );
        } else if (jsonData.p1) {
            p1Raw = jsonData.p1;
            p2Raw = jsonData.p2 || null;
            p3Raw = jsonData.p3 || null;
            dateVerified = isWIBTodayValid(
                jsonData.tanggal_wib || jsonData.tanggal || jsonData.date || jsonStr
            );
        } else if (jsonData.result) {
            p1Raw = jsonData.result;
            dateVerified = isWIBTodayValid(
                jsonData.tanggal_wib || jsonData.tanggal || jsonData.date || jsonStr
            );
        } else if (jsonData.data && jsonData.data.first_place) {
            p1Raw = String(jsonData.data.first_place).replace(/,/g, '');
            p2Raw = jsonData.data.second_place
                ? String(jsonData.data.second_place).replace(/,/g, '')
                : null;
            p3Raw = jsonData.data.third_place
                ? String(jsonData.data.third_place).replace(/,/g, '')
                : null;
            dateVerified = isWIBTodayValid(jsonData.date || jsonStr);
        } else if (jsonData.hk_1st) {
            p1Raw = jsonData.hk_1st;
            p2Raw = jsonData.hk_2nd || null;
            p3Raw = jsonData.hk_3rd || null;
            dateVerified = isWIBTodayValid(jsonData.hk_date || jsonStr);
        } else if (
            jsonData.success === true &&
            Array.isArray(jsonData.data) &&
            jsonData.data[0]?.today_results?.results
        ) {
            // Format Pewaristoto API
            const resObj = jsonData.data[0].today_results.results;
            const keys = Object.keys(resObj);
            if (keys.length > 0) {
                p1Raw = resObj[keys[0]];
            }
            dateVerified = isWIBTodayValid(
                jsonData.data[0].today_results.date || jsonStr
            );
        } else if (jsonData.status === 'sukses' && jsonData.angka_keluar) {
            p1Raw = jsonData.angka_keluar;
            dateVerified = isWIBTodayValid(jsonData.tanggal_wib || jsonStr);
        } else if (jsonData.status === 'belum_update') {
            throw new Error(jsonData.pesan || 'Belum update.');
        } else {
            throw new Error('Format JSON sumber tidak dikenali.');
        }
    } else {
        // HTML Parser
        const $ = cheerio.load(rawBody);
        dateVerified = isWIBTodayValid(rawBody);

        if (src.prizeSelectors) {
            if (src.isImageBall) {
                p1Raw = src.prizeSelectors.p1 ? extractImageBalls($, src.prizeSelectors.p1) : null;
                p2Raw = src.prizeSelectors.p2 ? extractImageBalls($, src.prizeSelectors.p2) : null;
                p3Raw = src.prizeSelectors.p3 ? extractImageBalls($, src.prizeSelectors.p3) : null;
            } else {
                p1Raw = src.prizeSelectors.p1
                    ? queryCheerio($, src.prizeSelectors.p1).first().text().trim()
                    : null;
                p2Raw = src.prizeSelectors.p2
                    ? queryCheerio($, src.prizeSelectors.p2).first().text().trim()
                    : null;
                p3Raw = src.prizeSelectors.p3
                    ? queryCheerio($, src.prizeSelectors.p3).first().text().trim()
                    : null;
            }
        } else if (src.selector) {
            if (src.joinAll) {
                p1Raw = queryCheerio($, src.selector)
                    .map((_, el) => $(el).text().trim())
                    .get()
                    .join('');
            } else if (src.isImageBall) {
                p1Raw = extractImageBalls($, src.selector);
            } else {
                p1Raw = queryCheerio($, src.selector).first().text().trim();
            }
        } else {
            p1Raw = $('.resultTable2').text().trim() || $('.outerbox').text().trim();
        }
    }

    if (!dateVerified) {
        throw new Error('Tanggal belum update untuk hari ini (WIB).');
    }

    const p1 = cleanFourDigits(p1Raw);
    const p2 = cleanFourDigits(p2Raw);
    const p3 = cleanFourDigits(p3Raw);

    if (!p1) {
        throw new Error('Angka P1 tidak valid atau belum lengkap.');
    }

    if (src.prizeSelectors?.p2 && !p2) {
        throw new Error('Angka P2 tidak valid atau belum lengkap.');
    }

    if (src.prizeSelectors?.p3 && !p3) {
        throw new Error('Angka P3 tidak valid atau belum lengkap.');
    }

    const tglWib = getTanggalWIB(new Date());

    return {
        status: 'sukses',
        pasaran: marketName,
        tanggal: tglWib,
        tanggal_wib: tglWib,
        angka_keluar: p1,
        ...(p1 ? { p1 } : {}),
        ...(p2 ? { p2 } : {}),
        ...(p3 ? { p3 } : {}),
        sumber: src.url
    };
}

async function scrapeAsianMarketFastest(slug) {
    const config = ASIAN_MARKETS[slug];
    if (!config) return null;

    const controller = new AbortController();

    const tasks = config.sources.map(src =>
        scrapeSingleAsianSource(config.pasaran, src, controller.signal)
    );

    try {
        const winner = await Promise.any(tasks);
        controller.abort();
        return winner;
    } catch (aggErr) {
        const reasons = aggErr?.errors
            ? [...new Set(aggErr.errors.map(e => e.message))].join(' | ')
            : 'Semua sumber belum update.';

        return {
            status: 'belum_update',
            pasaran: config.pasaran,
            pesan: reasons
        };
    }
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
        <title>Dashboard API Live Draw All Markets (48 Pasaran)</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #121212; color: #ffffff; margin: 0; padding: 20px; }
            .container { max-width: 1100px; margin: 0 auto; }
            h1 { color: #00e676; text-align: center; margin-bottom: 5px; }
            .waktu { text-align: center; color: #aaaaaa; margin-bottom: 30px; font-size: 1.1em; background: #1e1e1e; padding: 10px; border-radius: 8px; border: 1px solid #333;}
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
            .market-card { background: #1e1e1e; padding: 15px; border-radius: 8px; border-left: 5px solid #03a9f4; }
            .market-card h2 { margin-top: 0; color: #03a9f4; font-size: 1.2em; border-bottom: 1px solid #333; padding-bottom: 10px; }
            a { display: block; color: #ff9800; text-decoration: none; font-weight: bold; background: #2c2c2c; padding: 10px; margin-bottom: 8px; border-radius: 5px; text-align: center; transition: 0.3s;}
            a:hover { background: #ff9800; color: #121212; }
            .btn-utama { background: #d32f2f; border-left: 5px solid #d32f2f; }
            .btn-utama a { color: white; background: #b71c1c; }
            .btn-utama a:hover { background: #ff5252; }
            .macau-card { border-left-color: #e91e63; }
            .macau-card h2 { color: #e91e63; }
            .asia-card { border-left-color: #00e676; }
            .asia-card h2 { color: #00e676; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Server API Live Draw (48 Pasaran)</h1>
            <div class="waktu">Waktu Server: <strong>${waktuWIB}</strong></div>
            <div class="market-card btn-utama" style="margin-bottom: 20px;">
                <h2 style="color:white;">🌐 Pasaran Nasional USA</h2>
                <a href="/api/markets" target="_blank">Lihat Semua Pasaran Utama (Powerball, dll)</a>
            </div>
            <div class="grid">
                <div class="market-card macau-card">
                    <h2>🇲🇴 Toto Macau (4D)</h2>
                    <a href="/api/result/macau/0000" target="_blank">Putaran 00:01</a>
                    <a href="/api/result/macau/1300" target="_blank">Putaran 13:00</a>
                    <a href="/api/result/macau/1600" target="_blank">Putaran 16:00</a>
                    <a href="/api/result/macau/1900" target="_blank">Putaran 19:00</a>
                    <a href="/api/result/macau/2200" target="_blank">Putaran 22:00</a>
                    <a href="/api/result/macau/2300" target="_blank">Putaran 23:00</a>
                </div>

                <div class="market-card asia-card">
                    <h2>🌏 Asia & Australia (1)</h2>
                    <a href="/api/result/cambodia" target="_blank">Cambodia (CB)</a>
                    <a href="/api/result/bullseye" target="_blank">Bullseye (BSE)</a>
                    <a href="/api/result/sydney-pools" target="_blank">Sydney Pools (SDYP)</a>
                    <a href="/api/result/sydney-lotto" target="_blank">Sydney Lotto (SDYL)</a>
                    <a href="/api/result/china" target="_blank">China (CH)</a>
                    <a href="/api/result/japan" target="_blank">Japan (JPN)</a>
                </div>

                <div class="market-card asia-card">
                    <h2>🌏 Asia (2)</h2>
                    <a href="/api/result/singapore-toto" target="_blank">Singapore Toto (SGPT)</a>
                    <a href="/api/result/singapore-4d" target="_blank">Singapore 4D (SGP4D)</a>
                    <a href="/api/result/magnum-4d" target="_blank">Magnum 4D (MG4D)</a>
                    <a href="/api/result/pcso" target="_blank">PCSO (PSCO)</a>
                    <a href="/api/result/taiwan" target="_blank">Taiwan (TW)</a>
                    <a href="/api/result/taipei" target="_blank">Taipei (TAI)</a>
                </div>

                <div class="market-card macau-card">
                    <h2>🇭🇰 Hongkong</h2>
                    <a href="/api/result/hk-pools/day" target="_blank">Hongkong Day (HKD)</a>
                    <a href="/api/result/hk-pools/night" target="_blank">Hongkong Night (HKN)</a>
                    <a href="/api/result/hongkong" target="_blank">Hongkong (HK)</a>
                    <a href="/api/result/hongkong-lotto" target="_blank">Hongkong Lotto (HKL)</a>
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
                    <h2>🍑 Georgia & Missouri</h2>
                    <a href="/api/result/georgia/midday-4" target="_blank">GA Midday 4</a>
                    <a href="/api/result/georgia/cash-4-evening" target="_blank">GA Cash 4 Evening</a>
                    <a href="/api/result/missouri/midday-pick-4" target="_blank">MO Midday Pick 4</a>
                    <a href="/api/result/missouri/pick-4" target="_blank">MO Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏎️ Indiana & NJ</h2>
                    <a href="/api/result/indiana/midday-4" target="_blank">IN Midday 4</a>
                    <a href="/api/result/indiana/daily-4" target="_blank">IN Daily 4</a>
                    <a href="/api/result/new-jersey/midday-pick-4" target="_blank">NJ Midday Pick 4</a>
                    <a href="/api/result/new-jersey/pick-4" target="_blank">NJ Pick 4 Evening</a>
                </div>
                <div class="market-card">
                    <h2>🏖️ CA, AZ & IA</h2>
                    <a href="/api/result/california/daily-4" target="_blank">CA Daily 4</a>
                    <a href="/api/result/arizona/pick-4-midday" target="_blank">AZ Midday Pick 4</a>
                    <a href="/api/result/arizona/pick-4" target="_blank">AZ Pick 4 Evening</a>
                    <a href="/api/result/iowa/midday-4" target="_blank">IA Midday 4</a>
                    <a href="/api/result/iowa/pick-4" target="_blank">IA Pick 4 Evening</a>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    res.send(html);
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
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
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
                        tanggal: tanggalUndian,
                        tanggal_wib: tanggalUndian,
                        waktu_undian_wib: `${jamWeb} WIB`,
                        angka_keluar: angkaKeluar.join('')
                    };

                    return false;
                }

                if (!fallback) {
                    fallback = {
                        status: 'belum_update',
                        pesan: `Tanggal dan sesi cocok, tetapi jumlah angka yang ditemukan ${angkaKeluar.length}/4.`
                    };
                }

                return;
            }

            if (!fallback) {
                fallback = {
                    status: 'belum_update',
                    pesan: `Data putaran ${targetJam} untuk tanggal ${isoWib} belum tersedia.`
                };
            }
        });

        if (!payload) {
            payload = fallback;
        }

        if (!payload) {
            return res.json({
                status: 'belum_update',
                pesan: 'Data putaran Toto Macau hari ini belum ditemukan.'
            });
        }

        if (payload.status === 'sukses') {
            setCache(cacheKey, payload);
        }

        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: 'Gagal mengakses website Toto Macau.',
            detail: error.message
        });
    }
});

// ================= ENDPOINT HK POOLS DAY & NIGHT =================
app.get('/api/result/hk-pools/:market', async (req, res) => {
    const market = String(req.params.market || '').toLowerCase();
    const debug = req.query.debug === '1';

    if (!['day', 'night'].includes(market)) {
        return res.status(404).json({
            status: 'error',
            pesan: 'Market HK Pools tidak dikenal. Gunakan day atau night.'
        });
    }

    const namaPasaran = HKPOOLS_LABEL[market];
    const isoWib = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const cacheKey = `hk-pools-${market}-${isoWib}`;

    const hit = getCache(cacheKey);

    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
        return res.json(bentukRespons(hit, debug));
    }

    try {
        const html = await fetchWithAntiBlock(HKPOOLS_URL);
        const payload = parseHkPools(html, market);

        const hasilLengkap = Boolean(
            payload.tanggal_wib &&
            isWIBTodayValid(payload.tanggal_wib) &&
            /^\d{4}$/.test(payload.p1 || '') &&
            /^\d{4}$/.test(payload.p2 || '') &&
            /^\d{4}$/.test(payload.p3 || '')
        );

        if (!hasilLengkap) {
            return res.json({
                status: 'belum_update',
                pasaran: namaPasaran,
                pesan: 'Hasil HK Pools hari ini belum lengkap atau belum update.'
            });
        }

        setCache(cacheKey, payload);

        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pasaran: namaPasaran,
            pesan: 'Gagal mengambil atau membaca hasil HK Pools.',
            ...(debug ? { detail: error.message, url: HKPOOLS_URL } : {})
        });
    }
});

// ================= ENDPOINT NEW ZEALAND BULLSEYE =================
app.get('/api/result/bullseye', async (req, res) => {
    const debug = req.query.debug === '1';

    try {
        const payload = await ambilBullseye();

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));
    } catch (error) {
        // Fallback ke scraper sumber cadangan dari file bot jika API NZ belum update
        const fallbackRunner = async () => {
            const controller = new AbortController();
            const sources = [
                { url: 'https://togel-online.cc/livedraw/bullseye', selector: 'p.text-gold' },
                { url: 'https://rankcrack.com/bl.php', selector: 'td.prizenum' }
            ];
            const winner = await Promise.any(
                sources.map(src => scrapeSingleAsianSource('NEW ZEALAND BULLSEYE', src, controller.signal))
            );
            controller.abort();
            return winner;
        };

        try {
            const fallbackPayload = await fallbackRunner();
            return res.json(bentukRespons(fallbackPayload, debug));
        } catch (fbErr) {
            return res.json({
                status: 'belum_update',
                pasaran: 'NEW ZEALAND BULLSEYE',
                pesan: error.message
            });
        }
    }
});

// ================= ENDPOINT 13 PASARAN ASIA & TOGEL =================
// Mencakup: cambodia, sydney-pools, sydney-lotto, china, japan,
// singapore-toto, singapore-4d, magnum-4d, pcso, taiwan, taipei,
// hongkong, hongkong-lotto
app.get('/api/result/:market', async (req, res) => {
    const slug = String(req.params.market || '').toLowerCase();
    const debug = req.query.debug === '1';

    const config = ASIAN_MARKETS[slug];

    if (!config) {
        return res.status(404).json({
            status: 'error',
            pesan: `Pasaran '${slug}' tidak ditemukan.`
        });
    }

    const isoWib = iso(partsInTZ(new Date(), 'Asia/Jakarta'));
    const cacheKey = `asian_${slug}_${isoWib}`;

    const hit = getCache(cacheKey);
    if (hit) {
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
        return res.json(bentukRespons(hit, debug));
    }

    const payload = await scrapeAsianMarketFastest(slug);

    if (payload.status === 'sukses') {
        setCache(cacheKey, payload);
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
    }

    return res.json(bentukRespons(payload, debug));
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

                    waktuNY = localToDate(
                        hasilNY.tgl.y,
                        hasilNY.tgl.m,
                        hasilNY.tgl.d,
                        hhNY,
                        mmNY,
                        tz
                    );
                }

                const wibUndianNY = iso(partsInTZ(waktuNY, 'Asia/Jakarta'));
                const wibHariIni = iso(partsInTZ(new Date(), 'Asia/Jakarta'));

                if (wibUndianNY === wibHariIni) {
                    const payloadNY = {
                        status: 'sukses',
                        pasaran: game === 'midday-win-4' ? 'MIDDAY WIN 4' : 'WIN 4',
                        tanggal: getTanggalWIB(waktuNY),
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
        } catch (errorNY) {
            // Lanjut ke LotteryUSA
        }
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

                const wibUndianFl = iso(partsInTZ(waktuFl, 'Asia/Jakarta'));
                const wibHariIniFl = iso(partsInTZ(new Date(), 'Asia/Jakarta'));

                if (wibUndianFl === wibHariIniFl) {
                    const payloadFl = {
                        status: 'sukses',
                        pasaran: game === 'pick-4-midday'
                            ? 'MIDDAY PICK 4'
                            : 'PICK 4',
                        tanggal: getTanggalWIB(waktuFl),
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
        } catch (errorFl) {
            // Lanjut ke LotteryUSA
        }
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
            return res.json({
                status: 'belum_update',
                pesan: 'Angka hasil tidak ditemukan pada HTML.'
            });
        }

        const wadahAngka = cariWadahAngka($, bolaPertama);

        let tglRaw = cariTanggalRaw($, wadahAngka);

        if (!tglRaw) {
            tglRaw = cariTanggalRaw($, bolaPertama.parent());
        }

        const tglUndian = parseTanggal(tglRaw, tzNow);

        if (!tglUndian) {
            return res.json({
                status: 'belum_update',
                pesan: 'Tanggal undian tidak ditemukan atau formatnya tidak dikenali.'
            });
        }

        if (iso(tglUndian) > iso(tzNow)) {
            return res.json({
                status: 'belum_update',
                pesan: `Tanggal hasil web ${iso(tglUndian)} lebih baru daripada tanggal lokal ${iso(tzNow)} di ${tz}.`
            });
        }

        const kunci = `${state}/${game}`;
        const slot = SLOT_WIB[kunci];
        const jam = JADWAL[kunci];

        let waktuUndian = slot
            ? slotWIB(tglUndian, tz, slot)
            : null;

        if (!waktuUndian) {
            const [hh, mm] = (jam || JAM_DEFAULT).split(':').map(Number);

            waktuUndian = localToDate(
                tglUndian.y,
                tglUndian.m,
                tglUndian.d,
                hh,
                mm,
                tz
            );
        }

        const wibUndian = iso(partsInTZ(waktuUndian, 'Asia/Jakarta'));
        const wibHariIni = iso(partsInTZ(new Date(), 'Asia/Jakarta'));

        if (wibUndian !== wibHariIni) {
            return res.json({
                status: 'belum_update',
                pesan: `Tanggal hasil WIB (${wibUndian}) berbeda dari tanggal WIB hari ini (${wibHariIni}).`
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
            return res.json({
                status: 'belum_update',
                pesan: `Angka belum lengkap (${angka.length}/4).`
            });
        }

        const tglWib = getTanggalWIB(waktuUndian);
        const waktuWib = (slot || jam) ? jamWIB(waktuUndian) : null;

        const payload = {
            status: 'sukses',
            pasaran: namaPasaran,
            tanggal: tglWib,
            tanggal_wib: tglWib,
            waktu_undian_wib: waktuWib,
            tanggal_undian_us: iso(tglUndian),
            zona_undian: tz,
            angka_keluar: angka.join('')
        };

        setCache(cacheKey, payload);

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
        return res.json(bentukRespons(payload, debug));
    } catch (error) {
        return res.status(502).json({
            status: 'error',
            pesan: 'Gagal mengambil data dari target.',
            detail: error.message
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
        const html = await fetchWithAntiBlock('https://www.lotteryusa.com/');
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
