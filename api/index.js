const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- FUNGSI BANTUAN: MENDAPATKAN WAKTU WIB ---
function dapatkanWaktuWIB() {
    const opsi = { 
        timeZone: 'Asia/Jakarta', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return new Date().toLocaleString('id-ID', opsi) + " WIB";
}

// --- HALAMAN DEPAN API ---
app.get('/', (req, res) => {
    res.json({
        status: "success",
        message: "API Scraper LotteryUSA & Taiwan is Active!",
        waktu_server_wib: dapatkanWaktuWIB(),
        endpoints: { 
            semua_pasaran_utama: "/api/markets",
            pasaran_spesifik: "/api/result/:state/:game",
            radar_taiwan: "/api/taiwan-radar"
        }
    });
});

// --- FITUR: AMBIL PASARAN SPESIFIK (Contoh: Kentucky Pick 4) ---
app.get('/api/result/:state/:game', async (req, res) => {
    const state = req.params.state;
    const game = req.params.game;
    const targetUrl = `https://www.lotteryusa.com/${state}/${game}/`;

    try {
        const response = await axios.get(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        namaPasaran = namaPasaran.replace(/winning numbers/i, '').replace(/\s+/g, ' ').trim();
        
        let tanggalWeb = $('time').first().text().trim() \vert{}\vert{}$('[class*="date"]').first().text().trim();
        const tanggalWIB = dapatkanWaktuWIB();

        let angka_keluar = [];
        const bolaPertama = $('[class*="ball"]').first();
        if (bolaPertama.length > 0) {
            bolaPertama.parent().find('[class*="ball"]').each((i, el) => {
                const angka = $(el).text().trim();
                if (angka && angka.length <= 3) angka_keluar.push(angka);
            });
        }

        res.json({
            status: "sukses",
            sumber: targetUrl,
            data: { pasaran: namaPasaran, tanggal_web: tanggalWeb, tanggal_ditarik_wib: tanggalWIB, angka_keluar: angka_keluar }
        });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Gagal mengambil data", detail: error.message });
    }
});

// --- FITUR: AMBIL PASARAN UTAMA LOTTERYUSA ---
app.get('/api/markets', async (req, res) => {
    try {
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        const markets = [];
        const bukanLotre = ['PLAY', 'Play online', 'Daily game stats', 'On this day'];

        $('h3').each((index, element) => {
            const namaPasaran = $(element).text().trim();
            if (namaPasaran && !bukanLotre.includes(namaPasaran) && !namaPasaran.includes('?') && namaPasaran.length <= 25) {
                let parent = $(element).parent();
                let angka_keluar = [];
                let tanggal = "Belum diundi";
                let jackpot = "N/A";

                for (let level = 0; level < 5; level++) {
                    parent.find('[class*="ball"]').each((i, ballEl) => {
                        const angka = $(ballEl).text().trim();
                        if (angka && angka.length <= 3) angka_keluar.push(angka);
                    });

                    if (angka_keluar.length > 0) {
                        tanggal = parent.find('time, [class*="date"]').first().text().trim() || tanggal;
                        parent.find('[class*="jackpot"], [class*="prize"]').each((i, jpEl) => {
                            const jpText = $(jpEl).text().trim();
                            if(jpText && jpText.includes('$')) jackpot = jpText.replace(/\s+/g, ' ').trim();
                        });
                        break; 
                    }
                    parent = parent.parent(); 
                }
                if (angka_keluar.length > 0) {
                    markets.push({ pasaran: namaPasaran, tanggal_undian: tanggal, jackpot: jackpot, angka_keluar: angka_keluar });
                }
            }
        });
        res.json({ status: "sukses", waktu_update_wib: dapatkanWaktuWIB(), total_pasaran: markets.length, data: markets });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: error.message });
    }
});


// --- FITUR BARU: RADAR TAIWAN LOTTO (SCRAPER API PREMIUM) ---
app.get('/api/taiwan-radar', async (req, res) => {
    try {
        const targetUrl = 'https://www.taiwan-lotto.com/';
        const apiKey = '0e888f5e8fbf6c89a96da30cedd5d406';
        
        // 1. Tambahan &premium=true (Menggunakan IP Asli Perumahan agar tidak dicurigai)
        const scraperApiUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&premium=true`;

        // 2. Tambahan timer 20 detik. Jika lebih dari 20 detik, tampilkan error rapi, hindari Vercel 500 crash.
        const response = await axios.get(scraperApiUrl, { timeout: 20000 });
        
        const $ = cheerio.load(response.data);
        const judulHalaman = $('title').text().trim();
        
        const tagH1 = []; $('h1').each((i, el) => tagH1.push($(el).text().trim()));
        const tagH2 = []; $('h2').each((i, el) => tagH2.push($(el).text().trim()));
        
        const sampelTeks = [];
        $('div, span').each((i, el) => {
            const teks = $(el).text().trim();
            if (teks.length > 0 && teks.length < 5 && !isNaN(teks)) {
                sampelTeks.push(teks);
            }
        });

        res.json({
            status: "sukses_menembus_pakai_scraperapi_premium",
            pesan: "Luar biasa! Cloudflare berhasil dihancurkan oleh IP Premium ScraperAPI!",
            judul_halaman: judulHalaman,
            judul_h1_ditemukan: tagH1,
            judul_h2_ditemukan: tagH2,
            potensi_angka_ditemukan: sampelTeks.slice(0, 10)
        });

    } catch (error) {
        // Jika gagal karena timeout 20 detik, kita akan tahu alasannya dari JSON ini
        res.status(500).json({ 
            status: "GAGAL_MENEMBUS", 
            pesan: "ScraperAPI butuh waktu terlalu lama atau IP diblokir permanen oleh Cloudflare.",
            saran_sistem: "Mari kita cari website Live Draw Taiwan yang lain, website ini keamanannya terlalu berlebihan untuk API otomatis.",
            detail_error: error.message
        });
    }
});

module.exports = app;
