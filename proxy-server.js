const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://daytrade-ai.netlify.app";

// CORS restrito
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [ALLOWED_ORIGIN, "http://localhost:3000", "http://localhost:3001"];
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error("Origem não permitida"));
  },
  credentials: true,
}));

app.use(express.json());

// Rate limiting
const requestCounts = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  if (!requestCounts.has(ip)) { requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return next(); }
  const data = requestCounts.get(ip);
  if (now > data.resetAt) { requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return next(); }
  if (data.count >= RATE_LIMIT) return res.status(429).json({ error: "Muitas requisições. Aguarde 1 minuto." });
  data.count++;
  next();
}

setInterval(() => { const now = Date.now(); for (const [k, d] of requestCounts.entries()) { if (now > d.resetAt) requestCounts.delete(k); } }, 5 * 60 * 1000);
app.use(rateLimit);

const formatTicker = (ticker) => { const clean = ticker.split("·")[0].split("•")[0].trim(); return clean.endsWith(".SA") ? clean : `${clean}.SA`; };
const cleanTicker = (ticker) => ticker.split("·")[0].split("•")[0].trim().replace(".SA", "");

// IA para análise (Paper Trading / Dashboard)
app.post("/api/ai/analyze", async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq não configurado." });
  const { prompt, systemPrompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt obrigatório." });
  try {
    const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.3-70b-versatile", max_tokens: 800, temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt || "Trader quantitativo B3. Responda APENAS JSON válido." },
        { role: "user", content: prompt }
      ],
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 30000 });
    const text = response.data.choices?.[0]?.message?.content || "";
    try { return res.json({ success: true, data: JSON.parse(text.replace(/```json|```/g, "").trim()) }); }
    catch { return res.json({ success: true, data: { raw: text } }); }
  } catch (err) {
    if (err.response?.status === 429) return res.status(429).json({ error: "Limite do Groq atingido." });
    return res.status(500).json({ error: "Erro IA.", details: err.message });
  }
});

// Chat com IA + web search
app.post("/api/ai/chat", async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq não configurado." });
  const { messages, systemPrompt, webSearch } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: "Messages obrigatório." });

  let sources = [];
  let extraContext = "";

  // Web search via DuckDuckGo
  if (webSearch) {
    try {
      const lastMsg = messages[messages.length - 1]?.content || "";
      const query = encodeURIComponent(lastMsg.slice(0, 100) + " investimento Brasil 2025");
      const searchRes = await axios.get(`https://api.duckduckgo.com/?q=${query}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const results = searchRes.data;
      if (results.AbstractText) {
        extraContext += `\nFonte: ${results.AbstractSource}\n${results.AbstractText}\n`;
        sources.push(results.AbstractSource);
      }
      if (results.RelatedTopics?.length) {
        results.RelatedTopics.slice(0, 3).forEach(t => {
          if (t.Text) { extraContext += `• ${t.Text}\n`; }
          if (t.FirstURL) sources.push(t.FirstURL);
        });
      }
    } catch (e) {
      console.log("Web search falhou:", e.message);
    }

    // Busca notícias via Brapi se for sobre ativo específico
    const tickerMatch = messages[messages.length - 1]?.content?.match(/[A-Z]{4}[0-9]{1,2}|BTC|ETH|bitcoin|ethereum/i);
    if (tickerMatch && BRAPI_TOKEN) {
      try {
        const ticker = tickerMatch[0].toUpperCase();
        const newsRes = await axios.get(`https://brapi.dev/api/quote/${ticker}`, {
          params: { token: BRAPI_TOKEN, fundamental: true },
          timeout: 8000,
        });
        const quote = newsRes.data?.results?.[0];
        if (quote) {
          extraContext += `\nDADOS ATUAIS DO ATIVO ${ticker}:\n`;
          extraContext += `Preço: R$${quote.regularMarketPrice?.toFixed(2)}\n`;
          extraContext += `Variação hoje: ${quote.regularMarketChangePercent?.toFixed(2)}%\n`;
          extraContext += `Volume: ${quote.regularMarketVolume?.toLocaleString()}\n`;
          if (quote.priceEarnings) extraContext += `P/L: ${quote.priceEarnings?.toFixed(2)}\n`;
          if (quote.dividendsYield) extraContext += `DY: ${quote.dividendsYield?.toFixed(2)}%\n`;
          sources.push(`Brapi.dev - ${ticker}`);
        }
      } catch (e) {
        console.log("Brapi news falhou:", e.message);
      }
    }
  }

  const messagesWithContext = [...messages];
  if (extraContext) {
    messagesWithContext[messagesWithContext.length - 1] = {
      ...messagesWithContext[messagesWithContext.length - 1],
      content: messagesWithContext[messagesWithContext.length - 1].content + `\n\n[CONTEXTO DA WEB]:\n${extraContext}`
    };
  }

  try {
    const response = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.3-70b-versatile", max_tokens: 1500, temperature: 0.3,
      messages: [{ role: "system", content: systemPrompt }, ...messagesWithContext],
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 45000 });

    const content = response.data.choices?.[0]?.message?.content || "";
    return res.json({ success: true, data: { content, sources } });
  } catch (err) {
    if (err.response?.status === 429) return res.status(429).json({ error: "Limite do Groq atingido. Aguarde." });
    return res.status(500).json({ error: "Erro no chat.", details: err.message });
  }
});

// Preços via Brapi
app.get("/api/prices", async (req, res) => {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: "Parâmetro obrigatório: tickers" });
  const tickerList = tickers.split(",").map(t => cleanTicker(t.trim())).filter(Boolean);
  const results = {};
  try {
    const response = await axios.get(`https://brapi.dev/api/quote/${tickerList.join(",")}`, {
      params: { token: BRAPI_TOKEN }, timeout: 10000,
    });
    (response.data?.results || []).forEach(r => {
      results[r.symbol] = { price: r.regularMarketPrice || 0, previousClose: r.regularMarketPreviousClose || 0, change: r.regularMarketChangePercent || 0, realtime: true };
    });
    tickerList.forEach(t => { if (!results[t]) results[t] = { price: 0, previousClose: 0, change: 0, error: true }; });
  } catch {
    await Promise.all(tickerList.map(async (ticker) => {
      try {
        const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${formatTicker(ticker)}`, { params: { interval: "1m", range: "1d" }, headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 });
        const meta = r.data.chart.result[0].meta;
        results[ticker] = { price: parseFloat((meta.regularMarketPrice || 0).toFixed(2)), previousClose: parseFloat((meta.chartPreviousClose || 0).toFixed(2)), change: parseFloat(((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2)), realtime: false };
      } catch { results[ticker] = { price: 0, previousClose: 0, change: 0, error: true }; }
    }));
  }
  return res.json(results);
});

// Candles históricos
app.get("/api/candles", async (req, res) => {
  const { ticker, interval, range } = req.query;
  if (!ticker || !interval || !range) return res.status(400).json({ error: "Parâmetros obrigatórios." });
  const symbol = formatTicker(ticker);
  try {
    const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`, {
      params: { interval, range, includePrePost: false },
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      timeout: 10000,
    });
    const result = response.data.chart.result[0];
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
    if (BRAPI_TOKEN) {
      try {
        const clean = cleanTicker(ticker);
        const br = await axios.get(`https://brapi.dev/api/quote/${clean}`, { params: { token: BRAPI_TOKEN }, timeout: 5000 });
        const bd = br.data?.results?.[0];
        if (bd) { currentPrice = bd.regularMarketPrice || currentPrice; previousClose = bd.regularMarketPreviousClose || previousClose; }
      } catch {}
    }
    return res.json({ ticker: cleanTicker(ticker), symbol, interval, range, currentPrice, previousClose, candles, realtimePrice: !!BRAPI_TOKEN });
  } catch (err) {
    return res.status(500).json({ error: "Erro ao buscar dados.", details: err.message });
  }
});

// Health
app.get("/health", (req, res) => res.json({
  status: "ok", time: new Date().toISOString(),
  brapi: !!BRAPI_TOKEN, groq: !!GROQ_API_KEY,
  security: { cors: "restrito", rateLimit: `${RATE_LIMIT}/min` },
}));

app.listen(PORT, () => {
  console.log(`\n✅ Proxy SEGURO na porta ${PORT}`);
  console.log(`🔒 CORS: ${ALLOWED_ORIGIN}`);
  console.log(`🤖 Groq: ${GROQ_API_KEY ? "✅" : "❌"} | Brapi: ${BRAPI_TOKEN ? "✅" : "❌"}\n`);
});
