const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/', (req, res) => res.json({ message: "API is running!" }));

app.get('/api/markets', async (req, res) => {
    try {
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        
        // 1. Cek apakah web menggunakan brankas data Next.js (Sangat sering dipakai web modern)
        const nextDataString = $('#__NEXT_DATA__').html();
        if (nextDataString) {
            const nextData = JSON.parse(nextDataString);
            return res.json({
                status: "BINGGO_NEXTJS",
                pesan: "Data mentah berhasil ditemukan di brankas tersembunyi!",
                // Menampilkan kunci-kunci data agar kita tahu cara mengambilnya
                kunci_data: Object.keys(nextData.props.pageProps)
            });
        }

        // 2. Jika tidak, kita ambil judul-judul di website untuk melacak letaknya
        const tagH2 = []; $('h2').each((i, el) => tagH2.push($(el).text().trim()));
        const tagH3 = []; $('h3').each((i, el) => tagH3.push($(el).text().trim()));
        
        // 3. Kita cari letak pasaran "Powerball" untuk mengetahui nama bajunya (class)
        let classPowerball = "tidak_ditemukan";
        $('div, article, section').each((i, el) => {
            const teks = $(el).text();
            if (teks.includes('Powerball') && $(el).attr('class')) {
                classPowerball = $(el).attr('class');
                return false; // berhenti jika sudah ketemu
            }
        });

        res.json({
            status: "ANALISA_HTML_SELESAI",
            class_powerball_ditemukan: classPowerball,
            daftar_h2: tagH2.slice(0, 10),
            daftar_h3: tagH3.slice(0, 10)
        });

    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

module.exports = app;
