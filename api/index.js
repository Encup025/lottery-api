const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- HALAMAN DEPAN API ---
app.get('/', (req, res) => {
    res.json({
        status: "success",
        message: "API Scraper LotteryUSA is Active!",
        endpoints: { 
            semua_pasaran_utama: "/api/markets",
            pasaran_spesifik: "/api/result/:state/:game" // CONTOH: /api/result/kentucky/pick-4
        }
    });
});

// --- FITUR BARU: AMBIL PASARAN SPESIFIK (Contoh: Kentucky Pick 4) ---
app.get('/api/result/:state/:game', async (req, res) => {
    // Menangkap nama state dan game dari URL API Anda
    const state = req.params.state;
    const game = req.params.game;
    
    // Merakit URL target sesuai dengan format LotteryUSA
    const targetUrl = `https://www.lotteryusa.com/${state}/${game}/`;

    try {
        const response = await axios.get(targetUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        
        // 1. Ambil Nama Pasaran dari Judul Halaman (tag h1)
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        // Bersihkan kata "winning numbers" agar namanya lebih rapi
        namaPasaran = namaPasaran.replace(/winning numbers/i, '').trim();
        
        // 2. Ambil Tanggal Undian (dari tag <time> pertama di halaman)
        let tanggal = $('time').first().text().trim() || "Belum diundi";
        
        // 3. Ambil Angka Keluar Terbaru
        let angka_keluar = [];
        // Kita cari bola angka pertama yang muncul (karena itu pasti hasil draw terbaru)
        const bolaPertama = $('[class*="ball"]').first();
        
        if (bolaPertama.length > 0) {
            // Naik ke elemen pembungkusnya, lalu ambil semua bola di dalam baris tersebut
            bolaPertama.parent().find('[class*="ball"]').each((i, el) => {
                const angka = $(el).text().trim();
                if (angka && angka.length <= 3) {
                    angka_keluar.push(angka);
                }
            });
        }

        res.json({
            status: "sukses",
            sumber: targetUrl,
            data: {
                pasaran: namaPasaran,
                tanggal_undian: tanggal,
                angka_keluar: angka_keluar
            }
        });

    } catch (error) {
        // Jika link salah atau halaman tidak ditemukan
        res.status(500).json({ 
            status: "error", 
            pesan: "Gagal mengambil data. Pastikan nama state dan game benar (contoh: kentucky dan pick-4)", 
            url_target: targetUrl,
            detail: error.message 
        });
    }
});

// --- FITUR LAMA: AMBIL PASARAN UTAMA ---
app.get('/api/markets', async (req, res) => {
    // (Kode pembersih yang sudah berhasil tadi tetap ada di sini)
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

        res.json({ status: "sukses", waktu_update: new Date().toISOString(), total_pasaran: markets.length, data: markets });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: error.message });
    }
});

module.exports = app;
