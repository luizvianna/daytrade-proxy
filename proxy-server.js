const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const formatTicker = (ticker) => {
  if (ticker.endsWith(".SA")) return ticker;
  return `${ticker}.SA`;
};

// Buscar candles históricos
app.get("/api/candles", async (req, res) => {
  const { ticker, interval, range } = req.query;

  if (!ticker || !interval || !range) {
    return res.status(400).json({ error: "Parâmetros obrigatórios: ticker, interval, range" });
  }

  const symbol = formatTicker(ticker);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    const response = await axios.get(url, {
      params: { interval, range, includePrePost: false },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      timeout: 10000,
    });

    const chart = response.data.chart;
    if (!chart || chart.error) {
      return res.status(404).json({ error: "Ativo não encontrado ou indisponível" });
    }

    const result = chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    const candles = timestamps.map((ts, i) => ({
      time: new Date(ts * 1000).toISOString(),
      open: parseFloat((quotes.open[i] || 0).toFixed(2)),
      high: parseFloat((quotes.high[i] || 0).toFixed(2)),
      low: parseFloat((quotes.low[i] || 0).toFixed(2)),
      close: parseFloat((quotes.close[i] || 0).toFixed(2)),
      volume: quotes.volume[i] || 0,
    })).filter(c => c.close > 0);

    const meta = result.meta;

    return res.json({
      ticker: ticker.toUpperCase(),
      symbol,
      interval,
      range,
      currency: meta.currency,
      currentPrice: parseFloat((meta.regularMarketPrice || candles[candles.length - 1]?.close || 0).toFixed(2)),
      previousClose: parseFloat((meta.chartPreviousClose || 0).toFixed(2)),
      candles,
    });

  } catch (err) {
    console.error(`Erro ao buscar ${symbol}:`, err.message);
    return res.status(500).json({ error: "Erro ao buscar dados.", details: err.message });
  }
});

// Buscar preço atual de múltiplos ativos
app.get("/api/prices", async (req, res) => {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: "Parâmetro obrigatório: tickers" });

  const tickerList = tickers.split(",").map(t => t.trim());
  const results = {};

  await Promise.all(
    tickerList.map(async (ticker) => {
      const symbol = formatTicker(ticker);
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
        const response = await axios.get(url, {
          params: { interval: "1m", range: "1d" },
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 8000,
        });
        const meta = response.data.chart.result[0].meta;
        results[ticker.toUpperCase()] = {
          price: parseFloat((meta.regularMarketPrice || 0).toFixed(2)),
          previousClose: parseFloat((meta.chartPreviousClose || 0).toFixed(2)),
          change: parseFloat(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2)),
        };
      } catch {
        results[ticker.toUpperCase()] = { price: 0, previousClose: 0, change: 0, error: true };
      }
    })
  );

  return res.json(results);
});

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`\n✅ Proxy server rodando em http://localhost:${PORT}`);
  console.log(`📈 Buscando dados reais da B3 via Yahoo Finance`);
  console.log(`\nRotas disponíveis:`);
  console.log(`  GET /api/candles?ticker=PETR4&interval=5m&range=1d`);
  console.log(`  GET /api/prices?tickers=PETR4,VALE3,ITUB4\n`);
});
