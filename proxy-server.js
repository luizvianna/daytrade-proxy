const express = require("express");
const cors = require("cors");
const axios = require("axios");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://daytrade-ai.netlify.app";

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

const formatTicker = (t) => { const c = t.split("·")[0].split("•")[0].trim(); return c.endsWith(".SA") ? c : `${c}.SA`; };
const cleanTicker  = (t) => t.split("·")[0].split("•")[0].trim().replace(".SA","");

// ── IA: análise ──────────────────────────────────────────────
app.post("/api/ai/analyze", async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq não configurado." });
  const { prompt, systemPrompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt obrigatório." });
  try {
    const r = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.3-70b-versatile", max_tokens: 800, temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt || "Trader quantitativo B3. Responda APENAS JSON válido." },
        { role: "user", content: prompt }
      ],
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 30000 });
    const text = r.data.choices?.[0]?.message?.content || "";
    try { return res.json({ success: true, data: JSON.parse(text.replace(/```json|```/g,"").trim()) }); }
    catch { return res.json({ success: true, data: { raw: text } }); }
  } catch (err) {
    if (err.response?.status === 429) return res.status(429).json({ error: "Limite do Groq atingido." });
    return res.status(500).json({ error: "Erro IA.", details: err.message });
  }
});

// ── IA: chat + web search ────────────────────────────────────
app.post("/api/ai/chat", async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq não configurado." });
  const { messages, systemPrompt, webSearch } = req.body;
  if (!messages?.length) return res.status(400).json({ error: "Messages obrigatório." });

  let sources = [], extraContext = "";

  if (webSearch) {
    try {
      const lastMsg = messages[messages.length-1]?.content || "";
      const q = encodeURIComponent(lastMsg.slice(0,100) + " investimento Brasil 2025");
      const sr = await axios.get(`https://api.duckduckgo.com/?q=${q}&format=json&no_redirect=1&no_html=1&skip_disambig=1`, { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0" } });
      const results = sr.data;
      if (results.AbstractText) { extraContext += `\nFonte: ${results.AbstractSource}\n${results.AbstractText}\n`; sources.push(results.AbstractSource); }
      results.RelatedTopics?.slice(0,3).forEach(t => { if (t.Text) extraContext += `• ${t.Text}\n`; if (t.FirstURL) sources.push(t.FirstURL); });
    } catch (e) { console.log("Web search falhou:", e.message); }

    const tickerMatch = messages[messages.length-1]?.content?.match(/[A-Z]{4}[0-9]{1,2}|BTC|ETH|bitcoin|ethereum/i);
    if (tickerMatch && BRAPI_TOKEN) {
      try {
        const ticker = tickerMatch[0].toUpperCase();
        const nr = await axios.get(`https://brapi.dev/api/quote/${ticker}`, { params: { token: BRAPI_TOKEN, fundamental: true }, timeout: 8000 });
        const quote = nr.data?.results?.[0];
        if (quote) {
          extraContext += `\nDADOS ATUAIS ${ticker}: Preço R$${quote.regularMarketPrice?.toFixed(2)} | Var ${quote.regularMarketChangePercent?.toFixed(2)}% | Vol ${quote.regularMarketVolume?.toLocaleString()}`;
          if (quote.priceEarnings) extraContext += ` | P/L ${quote.priceEarnings?.toFixed(2)}`;
          if (quote.dividendsYield) extraContext += ` | DY ${quote.dividendsYield?.toFixed(2)}%`;
          extraContext += "\n"; sources.push(`Brapi.dev - ${ticker}`);
        }
      } catch (e) { console.log("Brapi falhou:", e.message); }
    }
  }

  const msgs = [...messages];
  if (extraContext) msgs[msgs.length-1] = { ...msgs[msgs.length-1], content: msgs[msgs.length-1].content + `\n\n[CONTEXTO DA WEB]:\n${extraContext}` };

  try {
    const r = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.3-70b-versatile", max_tokens: 1500, temperature: 0.3,
      messages: [{ role: "system", content: systemPrompt }, ...msgs],
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 45000 });
    return res.json({ success: true, data: { content: r.data.choices?.[0]?.message?.content || "", sources } });
  } catch (err) {
    if (err.response?.status === 429) return res.status(429).json({ error: "Limite do Groq atingido." });
    return res.status(500).json({ error: "Erro no chat.", details: err.message });
  }
});

// ── Preços ───────────────────────────────────────────────────
app.get("/api/prices", async (req, res) => {
  const { tickers } = req.query;
  if (!tickers) return res.status(400).json({ error: "Parâmetro obrigatório: tickers" });
  const list = tickers.split(",").map(t => cleanTicker(t.trim())).filter(Boolean);
  const results = {};
  try {
    const r = await axios.get(`https://brapi.dev/api/quote/${list.join(",")}`, { params: { token: BRAPI_TOKEN }, timeout: 10000 });
    (r.data?.results || []).forEach(r2 => { results[r2.symbol] = { price: r2.regularMarketPrice||0, previousClose: r2.regularMarketPreviousClose||0, change: r2.regularMarketChangePercent||0, realtime: true }; });
    list.forEach(t => { if (!results[t]) results[t] = { price:0, previousClose:0, change:0, error:true }; });
  } catch {
    await Promise.all(list.map(async (ticker) => {
      try {
        const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${formatTicker(ticker)}`, { params: { interval:"1m", range:"1d" }, headers: { "User-Agent":"Mozilla/5.0" }, timeout: 8000 });
        const m = r.data.chart.result[0].meta;
        results[ticker] = { price: parseFloat((m.regularMarketPrice||0).toFixed(2)), previousClose: parseFloat((m.chartPreviousClose||0).toFixed(2)), change: parseFloat(((m.regularMarketPrice-m.chartPreviousClose)/m.chartPreviousClose*100).toFixed(2)), realtime: false };
      } catch { results[ticker] = { price:0, previousClose:0, change:0, error:true }; }
    }));
  }
  return res.json(results);
});

// ── Candles ──────────────────────────────────────────────────
app.get("/api/candles", async (req, res) => {
  const { ticker, interval, range } = req.query;
  if (!ticker||!interval||!range) return res.status(400).json({ error: "Parâmetros obrigatórios." });
  try {
    const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${formatTicker(ticker)}`, {
      params: { interval, range, includePrePost: false },
      headers: { "User-Agent":"Mozilla/5.0", "Accept":"application/json" }, timeout: 10000,
    });
    const result = r.data.chart.result[0];
    const q = result.indicators.quote[0];
    const candles = result.timestamp.map((ts,i) => ({
      time: new Date(ts*1000).toISOString(),
      open:   parseFloat((q.open[i]  ||0).toFixed(2)),
      high:   parseFloat((q.high[i]  ||0).toFixed(2)),
      low:    parseFloat((q.low[i]   ||0).toFixed(2)),
      close:  parseFloat((q.close[i] ||0).toFixed(2)),
      volume: q.volume[i]||0,
    })).filter(c => c.close > 0);
    const meta = result.meta;
    let currentPrice = parseFloat((meta.regularMarketPrice||candles[candles.length-1]?.close||0).toFixed(2));
    let previousClose = parseFloat((meta.chartPreviousClose||0).toFixed(2));
    if (BRAPI_TOKEN) {
      try {
        const br = await axios.get(`https://brapi.dev/api/quote/${cleanTicker(ticker)}`, { params: { token: BRAPI_TOKEN }, timeout: 5000 });
        const bd = br.data?.results?.[0];
        if (bd) { currentPrice = bd.regularMarketPrice||currentPrice; previousClose = bd.regularMarketPreviousClose||previousClose; }
      } catch {}
    }
    return res.json({ ticker: cleanTicker(ticker), symbol: formatTicker(ticker), interval, range, currentPrice, previousClose, candles, realtimePrice: !!BRAPI_TOKEN });
  } catch (err) {
    return res.status(500).json({ error: "Erro ao buscar dados.", details: err.message });
  }
});

// ============================================================
// BANCO DE DADOS — Perfil, Conta, Alertas
// ============================================================

// ── Perfil ───────────────────────────────────────────────────
app.get("/api/perfil", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM perfis_investidor WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 1`, [db.USUARIO_FIXO_ID]);
    if (!r.rows.length) return res.json({ success: true, data: null });
    const row = r.rows[0];
    return res.json({ success: true, data: { nome: row.nome, tipoPerfil: row.tipo_perfil, pontuacao: row.pontuacao, capital: parseFloat(row.capital), orcamentoMensal: parseFloat(row.orcamento_mensal), respostas: row.respostas, atualizadoEm: row.atualizado_em } });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar perfil.", details: err.message }); }
});

app.post("/api/perfil", async (req, res) => {
  const { nome, tipoPerfil, pontuacao, capital, orcamentoMensal, respostas } = req.body;
  if (!tipoPerfil || pontuacao === undefined) return res.status(400).json({ error: "Campos obrigatórios: tipoPerfil, pontuacao." });
  try {
    const ex = await db.query(`SELECT id FROM perfis_investidor WHERE usuario_id=$1 LIMIT 1`, [db.USUARIO_FIXO_ID]);
    if (ex.rows.length) {
      await db.query(`UPDATE perfis_investidor SET nome=$1,tipo_perfil=$2,pontuacao=$3,capital=$4,orcamento_mensal=$5,respostas=$6,atualizado_em=now() WHERE id=$7`,
        [nome||null, tipoPerfil, pontuacao, capital||0, orcamentoMensal||0, respostas?JSON.stringify(respostas):null, ex.rows[0].id]);
    } else {
      await db.query(`INSERT INTO perfis_investidor(usuario_id,nome,tipo_perfil,pontuacao,capital,orcamento_mensal,respostas) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [db.USUARIO_FIXO_ID, nome||null, tipoPerfil, pontuacao, capital||0, orcamentoMensal||0, respostas?JSON.stringify(respostas):null]);
    }
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar perfil.", details: err.message }); }
});

// ── Conta ────────────────────────────────────────────────────
app.get("/api/conta", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM contas WHERE usuario_id=$1 LIMIT 1`, [db.USUARIO_FIXO_ID]);
    if (!r.rows.length) return res.json({ success: true, data: null });
    const row = r.rows[0];
    return res.json({ success: true, data: { saldoConta: parseFloat(row.saldo_conta), valorInvestido: parseFloat(row.valor_investido), lancamentosFuturos: parseFloat(row.lancamentos_futuros), corretora: row.corretora, conectado: row.conectado, valorRendaFixa: parseFloat(row.valor_renda_fixa||0), valorRendaVariavel: parseFloat(row.valor_renda_variavel||0), atualizadoEm: row.atualizado_em } });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar conta.", details: err.message }); }
});

app.post("/api/conta", async (req, res) => {
  const { saldoConta, valorInvestido, lancamentosFuturos, corretora, conectado, valorRendaFixa, valorRendaVariavel } = req.body;
  try {
    const ex = await db.query(`SELECT id FROM contas WHERE usuario_id=$1 LIMIT 1`, [db.USUARIO_FIXO_ID]);
    if (ex.rows.length) {
      await db.query(`UPDATE contas SET saldo_conta=$1,valor_investido=$2,lancamentos_futuros=$3,corretora=$4,conectado=$5,valor_renda_fixa=$6,valor_renda_variavel=$7,atualizado_em=now() WHERE id=$8`,
        [saldoConta||0, valorInvestido||0, lancamentosFuturos||0, corretora||null, conectado||false, valorRendaFixa||0, valorRendaVariavel||0, ex.rows[0].id]);
    } else {
      await db.query(`INSERT INTO contas(usuario_id,saldo_conta,valor_investido,lancamentos_futuros,corretora,conectado,valor_renda_fixa,valor_renda_variavel) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [db.USUARIO_FIXO_ID, saldoConta||0, valorInvestido||0, lancamentosFuturos||0, corretora||null, conectado||false, valorRendaFixa||0, valorRendaVariavel||0]);
    }
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar conta.", details: err.message }); }
});

// ── Alertas ──────────────────────────────────────────────────
app.get("/api/alertas", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM alertas WHERE usuario_id=$1 ORDER BY criado_em DESC`, [db.USUARIO_FIXO_ID]);
    return res.json({ success: true, data: r.rows.map(row => ({ id: row.id, ativo: row.ativo, tipo: row.tipo, direcao: row.direcao, valor: parseFloat(row.valor), emailAtivo: row.email_ativo, ativoFlag: row.ativo_flag, disparado: row.disparado, precoDisparo: row.preco_disparo?parseFloat(row.preco_disparo):null, criadoEm: row.criado_em, disparadoEm: row.disparado_em })) });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar alertas.", details: err.message }); }
});

app.post("/api/alertas", async (req, res) => {
  const { ativo, tipo, direcao, valor, emailAtivo } = req.body;
  if (!ativo||!tipo||valor===undefined) return res.status(400).json({ error: "Campos obrigatórios: ativo, tipo, valor." });
  try {
    const r = await db.query(`INSERT INTO alertas(usuario_id,ativo,tipo,direcao,valor,email_ativo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [db.USUARIO_FIXO_ID, ativo, tipo, direcao||null, valor, emailAtivo!==false]);
    return res.json({ success: true, id: r.rows[0].id });
  } catch (err) { return res.status(500).json({ error: "Erro ao criar alerta.", details: err.message }); }
});

app.put("/api/alertas/:id", async (req, res) => {
  const { id } = req.params;
  const { ativoFlag, disparado, precoDisparo } = req.body;
  try {
    const fields = [], values = []; let idx = 1;
    if (ativoFlag!==undefined)    { fields.push(`ativo_flag=$${idx++}`);    values.push(ativoFlag); }
    if (disparado!==undefined)    { fields.push(`disparado=$${idx++}`);     values.push(disparado); }
    if (precoDisparo!==undefined) { fields.push(`preco_disparo=$${idx++}`); values.push(precoDisparo); }
    if (disparado===true)         { fields.push(`disparado_em=now()`); }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });
    values.push(id, db.USUARIO_FIXO_ID);
    await db.query(`UPDATE alertas SET ${fields.join(",")} WHERE id=$${idx++} AND usuario_id=$${idx}`, values);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao atualizar alerta.", details: err.message }); }
});

app.delete("/api/alertas/:id", async (req, res) => {
  try {
    await db.query(`DELETE FROM alertas WHERE id=$1 AND usuario_id=$2`, [req.params.id, db.USUARIO_FIXO_ID]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao remover alerta.", details: err.message }); }
});

// ── Histórico de recomendações ──────────────────────────────────
app.get("/api/historico", async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM historico_recomendacoes WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 100`, [db.USUARIO_FIXO_ID]);
    return res.json({ success: true, data: r.rows.map(row => ({
      id: row.id, ativo: row.ativo, origem: row.origem, horizonte: row.horizonte,
      recomendacao: row.recomendacao, score: row.score ? parseFloat(row.score) : null,
      precoNoMomento: row.preco_no_momento ? parseFloat(row.preco_no_momento) : null,
      analise: row.analise, criadoEm: row.criado_em,
    })) });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar histórico.", details: err.message }); }
});

app.post("/api/historico", async (req, res) => {
  const { ativo, origem, horizonte, recomendacao, score, precoNoMomento, analise } = req.body;
  if (!ativo || !origem) return res.status(400).json({ error: "Campos obrigatórios: ativo, origem." });
  try {
    const r = await db.query(
      `INSERT INTO historico_recomendacoes(usuario_id,ativo,origem,horizonte,recomendacao,score,preco_no_momento,analise) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [db.USUARIO_FIXO_ID, ativo, origem, horizonte||null, recomendacao||null, score||null, precoNoMomento||null, analise||null]
    );
    return res.json({ success: true, id: r.rows[0].id });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar histórico.", details: err.message }); }
});

// ── Health ───────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  const dbOk = await db.testarConexao();
  res.json({ status:"ok", time:new Date().toISOString(), brapi:!!BRAPI_TOKEN, groq:!!GROQ_API_KEY, database:dbOk, security:{ cors:"restrito", rateLimit:`${RATE_LIMIT}/min` } });
});

app.listen(PORT, () => {
  console.log(`\n✅ Proxy SEGURO na porta ${PORT}`);
  console.log(`🔒 CORS: ${ALLOWED_ORIGIN}`);
  console.log(`🤖 Groq: ${GROQ_API_KEY?"✅":"❌"} | Brapi: ${BRAPI_TOKEN?"✅":"❌"} | DB: ${process.env.DATABASE_URL?"✅":"❌"}\n`);
});
