const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();

app.use(cors());

app.get('/', (req, res) => {
    res.json({
        status: "success",
        message: "LotteryUSA Scraper API is running on Render!",
        endpoints: { all_markets: "/api/markets" }
    });
});

app.get('/api/markets', async (req, res) => {
    try {
        const response = await axios.get('https://www.lotteryusa.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });

        const $ = cheerio.load(response.data);
        const markets = [];

        $('.c-state-results__item, .game-card, .lottery-item').each((index, element) => {
            const name = $(element).find('.c-game-title, .game-name, h3').text().trim();
            const jackpot = $(element).find('.c-jackpot, .jackpot, .prize').text().trim() || "N/A";
            const date = $(element).find('.c-draw-date, .date, time').text().trim() || "N/A";
            
            const numbers = [];
            $(element).find('.c-ball, .ball, .number').each((i, el) => {
                const num = $(el).text().trim();
                if(num) numbers.push(num);
            });

            if (name) {
                markets.push({
                    name: name,
                    jackpot: jackpot,
                    date: date,
                    numbers: numbers.length > 0 ? numbers : ["Data belum tersedia"]
                });
            }
        });

        res.json({
            status: "success",
            source: "https://www.lotteryusa.com",
            updated_at: new Date().toISOString(),
            total: markets.length,
            data: markets
        });

    } catch (error) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server API berjalan di port ${PORT}`);
});
