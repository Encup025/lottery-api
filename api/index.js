const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// --- FUNGSI BANTUAN: MENDAPATKAN WAKTU WIB ---
// Karena Vercel menggunakan server global (UTC), kita paksa konversi ke WIB (Asia/Jakarta)
function dapatkanWaktuWIB() {
    const opsi = { 
        timeZone: 'Asia/Jakarta', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false // Menggunakan format 24 jam
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
            radar_taiwan: "/api/taiwan-radar" // Tambahan rute baru
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        
        // 1. Ambil Nama Pasaran & Bersihkan Spasi
        let namaPasaran = $('h1').text().trim() || `${state} ${game}`;
        namaPasaran = namaPasaran.replace(/winning numbers/i, '');
        namaPasaran = namaPasaran.replace(/\s+/g, ' ').trim(); // Menghapus enter (\n) dan tab (\t)
        
        // 2. Ambil Tanggal Undian (Dari website LotteryUSA)
        let tanggalWeb = "";
        let timeText = $('time').first().text().trim();
        
        if (timeText) {
             tanggalWeb = timeText;
        } else {
             tanggalWeb = $('[class*="date"]').first().text().trim();
        }

        // Catatan waktu aktual (WIB) saat data ditarik oleh bot Anda
        const tanggalWIB = dapatkanWaktuWIB();

        // 3. Ambil Angka Keluar Terbaru
        let angka_keluar = [];
        const bolaPertama = $('[class*="ball"]').first();
        
        if (bolaPertama.length > 0) {
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
                tanggal_web_usa: tanggalWeb, // Apa yang tertulis di web target (misal: "Today at...")
                tanggal_ditarik_wib: tanggalWIB, // Waktu aktual scraping dalam WIB
                angka_keluar: angka_keluar
            }
        });

    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Gagal mengambil data", detail: error.message });
    }
});


// --- FITUR: AMBIL PASARAN UTAMA ---
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

        res.json({ 
            status: "sukses", 
            waktu_update_wib: dapatkanWaktuWIB(), // Memakai format WIB 
            total_pasaran: markets.length, 
            data: markets 
        });
    } catch (error) {
        res.status(500).json({ status: "error", pesan: error.message });
    }
});


// --- FITUR BARU: RADAR TAIWAN LOTTO ---
app.get('/api/taiwan-radar', async (req, res) => {
    try {
        const response = await axios.get('https://www.taiwan-lotto.com/', {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        const $ = cheerio.load(response.data);
        const judulHalaman = $('title').text().trim();
        
        // Mengambil sampel data HTML untuk melihat posisi bola angkanya
        const tagDiv = []; 
        $('div').each((i, el) => {
            const className = $(el).attr('class');
            if(className) tagDiv.push(className);
        });

        res.json({
            status: "sukses_menembus",
            pesan: "Horee! Tidak diblokir Cloudflare",
            judul_halaman: judulHalaman,
            sampel_class_html: tagDiv.slice(0, 15) // Ambil 15 class pertama
        });

    } catch (error) {
        res.status(500).json({ 
            status: "TERBLOKIR_CLOUDFLARE", 
            kode_error: error.response ? error.response.status : error.message,
            pesan: "Akses ditolak. Kita harus pakai jalur belakang (Bypass API)!" 
        });
    }
});

module.exports = app;
