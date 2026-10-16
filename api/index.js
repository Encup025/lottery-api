const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- FUNGSI BANTUAN: WAKTU WIB ---
function dapatkanWaktuWIB() {
    const opsi = { 
        timeZone: 'Asia/Jakarta', year: 'numeric', month: 'long', 
        day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    };
    return new Date().toLocaleString('id-ID', opsi) + " WIB";
}

// --- HALAMAN DEPAN ---
app.get('/', (req, res) => {
    res.json({
        status: "success",
        message: "API Scraper LotteryUSA is Active!",
        waktu_server_wib: dapatkanWaktuWIB(),
        endpoints: { 
            semua_pasaran_utama: "/api/markets",
            pasaran_spesifik: "/api/result/:state/:game"
        }
    });
});

// --- FITUR: AMBIL PASARAN SPESIFIK (Contoh: kentucky/pick-4) ---
app.get('/api/result/:state/:game', async (req, res) => {
    const state = req.params.state;
    const game = req.params.game;
    const targetUrl = `https://www.lotteryusa.com/${state}/${game}/`;

    try {
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(response.data);
        
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        namaPasaran = namaPasaran.replace(/winning numbers/i, '').replace(/\s+/g, ' ').trim();
        let tanggalWeb = $('time').first().text().trim() \vert{}\vert{}$('[class*="date"]').first().text().trim();

        let angka_keluar = [];
        const bolaPertama = $('[class*="ball"]').first();
        if (bolaPertama.length > 0) {
            bolaPertama.parent().find('[class*="ball"]').each((i, el) => {
                const angka = $(el).text().trim();
                if (angka && angka.length <= 3) angka_keluar.push(angka);
            });
        }

        res.json({
            status: "sukses", sumber: targetUrl,
            data: { pasaran: namaPasaran, tanggal_web: tanggalWeb, tanggal_ditarik_wib: dapatkanWaktuWIB(), angka_keluar: angka_keluar }
        });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Gagal mengambil data", detail: error.message });
    }
});

// --- FITUR: AMBIL PASARAN UTAMA ---
app.get('/api/markets', async (req, res) => {
    try {
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(response.data);
        const markets = [];
        const bukanLotre = ['PLAY', 'Play online', 'Daily game stats', 'On this day'];

        $('h3').each((index, element) => {
            const namaPasaran = $(element).text().trim();
            if (namaPasaran && !bukanLotre.includes(namaPasaran) && !namaPasaran.includes('?') && namaPasaran.length <= 25) {
                let parent = $(element).parent();
                let angka_keluar = [];
                let tanggal = "Belum diundi", jackpot = "N/A";

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

module.exports = app;
