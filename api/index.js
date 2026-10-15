const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Halaman Depan API
app.get('/', (req, res) => {
    res.json({
        status: "success",
        message: "API Scraper LotteryUSA is Active!",
        endpoints: {
            live_draw: "/api/markets"
        }
    });
});

// Halaman Pengambil Data
app.get('/api/markets', async (req, res) => {
    try {
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        const markets = [];
        
        // Membuang teks yang bukan nama pasaran lotre (seperti nama penulis berita)
        const bukanLotre = ['Todd Betzold', 'Samantha Herscher', 'Alex Cramer', 'Dr. Catalin Barboianu', 'Laura Gariepy', 'PLAY', 'Play online'];

        // Mulai mencari di semua judul h3
        $('h3').each((index, element) => {
            const namaPasaran = $(element).text().trim();

            // Memastikan ini adalah nama pasaran sungguhan
            if (namaPasaran && !bukanLotre.includes(namaPasaran)) {
                
                let parent = $(element).parent();
                let angka_keluar = [];
                let tanggal = "Belum diundi";
                let jackpot = "N/A";

                // Robot akan naik ke atas dari h3 untuk mencari kotak pembungkus angkanya
                for (let level = 0; level < 5; level++) {
                    
                    // Mencari class HTML yang berbau "ball" (bola angka)
                    parent.find('[class*="ball"]').each((i, ballEl) => {
                        const angka = $(ballEl).text().trim();
                        if (angka && angka.length <= 3) { // Memastikan itu format angka togel (maks 3 digit per bola)
                            angka_keluar.push(angka);
                        }
                    });

                    // Jika robot berhasil menemukan angka, kita ambil sekalian tanggal dan jackpotnya
                    if (angka_keluar.length > 0) {
                        tanggal = parent.find('time, [class*="date"]').first().text().trim() || tanggal;
                        
                        parent.find('[class*="jackpot"], [class*="prize"]').each((i, jpEl) => {
                            const jpText = $(jpEl).text().trim();
                            if(jpText && jpText.includes('$')) jackpot = jpText;
                        });
                        break; // Berhenti mencari ke atas karena sudah ketemu datanya
                    }
                    
                    parent = parent.parent(); // Naik 1 level lagi jika belum ketemu
                }

                // Jika angkanya ada, masukkan ke database hasil kita!
                if (angka_keluar.length > 0) {
                    markets.push({
                        pasaran: namaPasaran,
                        tanggal_undian: tanggal,
                        jackpot: jackpot,
                        angka_keluar: angka_keluar
                    });
                }
            }
        });

        res.json({
            status: "sukses",
            sumber: "https://www.lotteryusa.com",
            waktu_update: new Date().toISOString(),
            total_pasaran: markets.length,
            data: markets
        });

    } catch (error) {
        res.status(500).json({ status: "error", pesan: "Ada gangguan sistem", detail: error.message });
    }
});

module.exports = app;
