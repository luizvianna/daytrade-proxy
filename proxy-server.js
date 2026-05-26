const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";

app.use(cors());
app.use(express.json());

const formatTicker = (ticker) => {
  const clean = ticker.split("·")[0].split("•")[0].trim();
  if (clean.endsWith(".SA")) return clean;
  return `${clean}.SA`;
};

const cleanTicker = (ticker) => ticker.split("·")[0].split("•")[0].trim().replace(".SA", "");

// ── Preço em tempo real via Brapi ─────────────────────────────────
app.get("/api/quote", async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "Parâmetro obrigatório: ticker" });

  const clean = cleanTicker(ticker);

  try {
    const url = `https://brapi.dev/api/quote/${clean}`;
    const response = await axios.get(url, {
      params: { token: BRAPI_TOKEN },
      timeout: 8000,
    });

    const result = response.data?.results?.[0];
    if (!result) throw new Error("Ativo não encontrado");

    return res.json({
      ticker: clean,
      price: result.regularMarketPrice,
      previousClose: result.regularMarketPreviousClose,
      change: result.regularMarketChange,
      changePercent: result.regularMarketChangePercent,
      high: result.regularMarketDayHigh,
      low: result.regularMarketDayLow,
      volume: result.regularMarketVolume,
      marketCap: result.marketCap,
      updatedAt: result.updatedAt,
      realtime: true,
    });
  } catch (e) {
    console.error(`Erro Brapi ${clean}:`, e.message);
    return res.status(500).json({ error: "Erro ao buscar preço", details: e.message });
  }
});

// ── Preços múltiplos via Brapi ────────────────────────────────────
app.get("/api/prices", async (req, res) => {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: "Parâmetro obrigatório: tickers" });

  const tickerList = tickers.split(",").map(t => cleanTicker(t.trim())).filter(Boolean);
  const results = {};

  try {
    // Brapi aceita múltiplos tickers de uma vez
    const url = `https://brapi.dev/api/quote/${tickerList.join(",")}`;
    const response = await axios.get(url, {
      params: { token: BRAPI_TOKEN },
      timeout: 10000,
    });

    const brapiResults = response.data?.results || [];
    brapiResults.forEach(r => {
      results[r.symbol] = {
        price: r.regularMarketPrice || 0,
        previousClose: r.regularMarketPreviousClose || 0,
        change: r.regularMarketChangePercent || 0,
        high: r.regularMarketDayHigh || 0,
        low: r.regularMarketDayLow || 0,
        volume: r.regularMarketVolume || 0,
        realtime: true,
      };
    });

    // Preenche ativos que não vieram na resposta
    tickerList.forEach(t => {
      if (!results[t]) results[t] = { price: 0, previousClose: 0, change: 0, error: true };
    });

  } catch (e) {
    console.error("Erro Brapi prices:", e.message);
    // Fallback para Yahoo Finance
    await Promise.all(tickerList.map(async (ticker) => {
      const symbol = formatTicker(ticker);
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
        const response = await axios.get(url, {
          params: { interval: "1m", range: "1d" },
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 8000,
        });
        const meta = response.data.chart.result[0].meta;
        results[ticker] = {
          price: parseFloat((meta.regularMarketPrice || 0).toFixed(2)),
          previousClose: parseFloat((meta.chartPreviousClose || 0).toFixed(2)),
          change: parseFloat(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2)),
          realtime: false,
        };
      } catch {
        results[ticker] = { price: 0, previousClose: 0, change: 0, error: true };
      }
    }));
  }

  return res.json(results);
});

// ── Candles históricos via Yahoo Finance ──────────────────────────
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
    if (!chart || chart.error) return res.status(404).json({ error: "Ativo não encontrado" });

    const result = chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    const meta = result.meta;

    const candles = timestamps.map((ts, i) => ({
      time: new Date(ts * 1000).toISOString(),
      open: parseFloat((quotes.open[i] || 0).toFixed(2)),
      high: parseFloat((quotes.high[i] || 0).toFixed(2)),
      low: parseFloat((quotes.low[i] || 0).toFixed(2)),
      close: parseFloat((quotes.close[i] || 0).toFixed(2)),
      volume: quotes.volume[i] || 0,
    })).filter(c => c.close > 0);

    // Tenta pegar preço atual do Brapi (mais preciso)
    let currentPrice = parseFloat((meta.regularMarketPrice || candles[candles.length - 1]?.close || 0).toFixed(2));
    let previousClose = parseFloat((meta.chartPreviousClose || 0).toFixed(2));

    if (BRAPI_TOKEN) {
      try {
        const clean = cleanTicker(ticker);
        const brapiRes = await axios.get(`https://brapi.dev/api/quote/${clean}`, {
          params: { token: BRAPI_TOKEN },
          timeout: 5000,
        });
        const brapiData = brapiRes.data?.results?.[0];
        if (brapiData) {
          currentPrice = brapiData.regularMarketPrice || currentPrice;
          previousClose = brapiData.regularMarketPreviousClose || previousClose;
        }
      } catch (e) {
        console.log("Brapi fallback para Yahoo no preço atual");
      }
    }

    return res.json({
      ticker: cleanTicker(ticker),
      symbol,
      interval,
      range,
      currency: meta.currency,
      currentPrice,
      previousClose,
      candles,
      realtimePrice: !!BRAPI_TOKEN,
    });

  } catch (err) {
    console.error(`Erro candles ${symbol}:`, err.message);
    return res.status(500).json({ error: "Erro ao buscar dados.", details: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({
  status: "ok",
  time: new Date().toISOString(),
  brapi: !!BRAPI_TOKEN,
  message: BRAPI_TOKEN ? "Preços em tempo real via Brapi ✅" : "Usando Yahoo Finance (sem Brapi token)"
}));

app.listen(PORT, () => {
  console.log(`\n✅ Proxy server rodando na porta ${PORT}`);
  console.log(`📈 Dados históricos: Yahoo Finance`);
  console.log(`⚡ Preços em tempo real: ${BRAPI_TOKEN ? "Brapi.dev ✅" : "Yahoo Finance (configure BRAPI_TOKEN)"}`);
  console.log(`\nRotas:`);
  console.log(`  GET /api/quote?ticker=PETR4`);
  console.log(`  GET /api/prices?tickers=PETR4,VALE3`);
  console.log(`  GET /api/candles?ticker=PETR4&interval=5m&range=5d\n`);
});
