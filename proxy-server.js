const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://daytrade-ai.netlify.app";

// ── NÍVEL 3: CORS restrito ao domínio Netlify ─────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      ALLOWED_ORIGIN,
      "http://localhost:3000",
      "http://localhost:3001",
    ];
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 Origem bloqueada: ${origin}`);
      callback(new Error("Origem não permitida"));
    }
  },
  credentials: true,
}));

app.use(express.json());

// ── NÍVEL 3: Rate Limiting ────────────────────────────────────────
const requestCounts = new Map();
const RATE_LIMIT = 60; // max requisições por minuto por IP
const RATE_WINDOW = 60 * 1000; // 1 minuto

function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const key = `${ip}`;

  if (!requestCounts.has(key)) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return next();
  }

  const data = requestCounts.get(key);
  if (now > data.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return next();
  }

  if (data.count >= RATE_LIMIT) {
    console.warn(`🚫 Rate limit atingido para IP: ${ip}`);
    return res.status(429).json({ error: "Muitas requisições. Aguarde 1 minuto." });
  }

  data.count++;
  next();
}

// Limpa o mapa de rate limit periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now > data.resetAt) requestCounts.delete(key);
  }
}, 5 * 60 * 1000);

app.use(rateLimit);

// ── Helpers ───────────────────────────────────────────────────────
const formatTicker = (ticker) => {
  const clean = ticker.split("·")[0].split("•")[0].trim();
  if (clean.endsWith(".SA")) return clean;
  return `${clean}.SA`;
};

const cleanTicker = (ticker) => ticker.split("·")[0].split("•")[0].trim().replace(".SA", "");

// ── NÍVEL 2: Groq via proxy (chave nunca vai ao browser) ──────────
app.post("/api/ai/analyze", async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq não configurado no servidor." });

  const { prompt, systemPrompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt obrigatório." });

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        max_tokens: 800,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt || "Trader quantitativo B3. Responda APENAS JSON válido, sem texto extra." },
          { role: "user", content: prompt }
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        timeout: 30000,
      }
    );

    const text = response.data.choices?.[0]?.message?.content || "";
    const clean = text.replace(/```json|```/g, "").trim();

    try {
      const parsed = JSON.parse(clean);
      return res.json({ success: true, data: parsed });
    } catch {
      return res.json({ success: true, data: { raw: clean } });
    }

  } catch (err) {
    console.error("Erro Groq:", err.message);
    if (err.response?.status === 429) {
      return res.status(429).json({ error: "Limite do Groq atingido. Aguarde alguns minutos." });
    }
    return res.status(500).json({ error: "Erro ao consultar IA.", details: err.message });
  }
});

// ── Preço em tempo real via Brapi ─────────────────────────────────
app.get("/api/quote", async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "Parâmetro obrigatório: ticker" });
  const clean = cleanTicker(ticker);
  try {
    const response = await axios.get(`https://brapi.dev/api/quote/${clean}`, {
      params: { token: BRAPI_TOKEN },
      timeout: 8000,
    });
    const result = response.data?.results?.[0];
    if (!result) throw new Error("Ativo não encontrado");
    return res.json({
      ticker: clean, price: result.regularMarketPrice,
      previousClose: result.regularMarketPreviousClose,
      change: result.regularMarketChange,
      changePercent: result.regularMarketChangePercent,
      high: result.regularMarketDayHigh, low: result.regularMarketDayLow,
      volume: result.regularMarketVolume, realtime: true,
    });
  } catch (e) {
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
    const response = await axios.get(`https://brapi.dev/api/quote/${tickerList.join(",")}`, {
      params: { token: BRAPI_TOKEN },
      timeout: 10000,
    });
    const brapiResults = response.data?.results || [];
    brapiResults.forEach(r => {
      results[r.symbol] = {
        price: r.regularMarketPrice || 0,
        previousClose: r.regularMarketPreviousClose || 0,
        change: r.regularMarketChangePercent || 0,
        realtime: true,
      };
    });
    tickerList.forEach(t => { if (!results[t]) results[t] = { price: 0, previousClose: 0, change: 0, error: true }; });
  } catch (e) {
    // Fallback Yahoo Finance
    await Promise.all(tickerList.map(async (ticker) => {
      const symbol = formatTicker(ticker);
      try {
        const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
          params: { interval: "1m", range: "1d" },
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 8000,
        });
        const meta = r.data.chart.result[0].meta;
        results[ticker] = {
          price: parseFloat((meta.regularMarketPrice || 0).toFixed(2)),
          previousClose: parseFloat((meta.chartPreviousClose || 0).toFixed(2)),
          change: parseFloat(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2)),
          realtime: false,
        };
      } catch { results[ticker] = { price: 0, previousClose: 0, change: 0, error: true }; }
    }));
  }
  return res.json(results);
});

// ── Candles históricos via Yahoo Finance ──────────────────────────
app.get("/api/candles", async (req, res) => {
  const { ticker, interval, range } = req.query;
  if (!ticker || !interval || !range) return res.status(400).json({ error: "Parâmetros obrigatórios: ticker, interval, range" });
  const symbol = formatTicker(ticker);
  try {
    const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      params: { interval, range, includePrePost: false },
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json" },
      timeout: 10000,
    });
    const chart = response.data.chart;
    if (!chart || chart.error) return res.status(404).json({ error: "Ativo não encontrado" });
    const result = chart.result[0];
    const candles = result.timestamp.map((ts, i) => ({
      time: new Date(ts * 1000).toISOString(),
      open: parseFloat((result.indicators.quote[0].open[i] || 0).toFixed(2)),
      high: parseFloat((result.indicators.quote[0].high[i] || 0).toFixed(2)),
      low: parseFloat((result.indicators.quote[0].low[i] || 0).toFixed(2)),
      close: parseFloat((result.indicators.quote[0].close[i] || 0).toFixed(2)),
      volume: result.indicators.quote[0].volume[i] || 0,
    })).filter(c => c.close > 0);

    const meta = result.meta;
    let currentPrice = parseFloat((meta.regularMarketPrice || candles[candles.length-1]?.close || 0).toFixed(2));
    let previousClose = parseFloat((meta.chartPreviousClose || 0).toFixed(2));

    // Tenta enriquecer com Brapi
    if (BRAPI_TOKEN) {
      try {
        const clean = cleanTicker(ticker);
        const brapiRes = await axios.get(`https://brapi.dev/api/quote/${clean}`, {
          params: { token: BRAPI_TOKEN }, timeout: 5000,
        });
        const brapiData = brapiRes.data?.results?.[0];
        if (brapiData) { currentPrice = brapiData.regularMarketPrice || currentPrice; previousClose = brapiData.regularMarketPreviousClose || previousClose; }
      } catch {}
    }

    return res.json({ ticker: cleanTicker(ticker), symbol, interval, range, currentPrice, previousClose, candles, realtimePrice: !!BRAPI_TOKEN });
  } catch (err) {
    return res.status(500).json({ error: "Erro ao buscar dados.", details: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({
  status: "ok",
  time: new Date().toISOString(),
  brapi: !!BRAPI_TOKEN,
  groq: !!GROQ_API_KEY,
  security: { cors: "restrito", rateLimit: `${RATE_LIMIT} req/min`, groqProxy: !!GROQ_API_KEY },
}));

app.listen(PORT, () => {
  console.log(`\n✅ Proxy SEGURO rodando na porta ${PORT}`);
  console.log(`🔒 CORS: apenas ${ALLOWED_ORIGIN}`);
  console.log(`⚡ Rate limit: ${RATE_LIMIT} req/min`);
  console.log(`🤖 Groq via proxy: ${GROQ_API_KEY ? "✅ configurado" : "❌ não configurado"}`);
  console.log(`📈 Brapi: ${BRAPI_TOKEN ? "✅ configurado" : "❌ não configurado"}\n`);
});
