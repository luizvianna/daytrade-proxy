const express = require("express");
const cors = require("cors");
const axios = require("axios");
const db = require("./db");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3001;
const BRAPI_TOKEN = process.env.BRAPI_TOKEN || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://daytrade-ai.netlify.app";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://tbgoxrhoosxcrqqhtpbh.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Limiar padrão (%) dos alertas criados automaticamente ao favoritar um
// ativo na watchlist. Fácil de ajustar aqui sem precisar caçar no meio do
// código.
const LIMIAR_ALERTA_WATCHLIST = 5;

// Middleware: exige um token válido, garante que existe linha em `usuarios`,
// e coloca o usuario_id real em req.usuarioId
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token de autenticação ausente." });
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Token inválido ou expirado." });
    req.usuarioId = data.user.id;

    // Garante que existe uma linha em `usuarios` pra esse id (necessário
    // pra foreign keys de outras tabelas e pro is_admin funcionarem)
    await db.query(
      `INSERT INTO usuarios(id, email) VALUES($1,$2) ON CONFLICT (id) DO NOTHING`,
      [data.user.id, data.user.email || null]
    );

    next();
  } catch (e) {
    return res.status(401).json({ error: "Erro ao validar autenticação." });
  }
}

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

// ── IA: análise (sem auth — não acessa dados pessoais) ────────
app.post("/api/ai/analyze", async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: "Groq não configurado." });
  const { prompt, systemPrompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt obrigatório." });
  try {
    const r = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "openai/gpt-oss-120b", max_tokens: 800, temperature: 0.2,
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

// ── IA: chat + web search (sem auth) ──────────────────────────
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
      model: "openai/gpt-oss-120b", max_tokens: 1500, temperature: 0.3,
      messages: [{ role: "system", content: systemPrompt }, ...msgs],
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 45000 });
    return res.json({ success: true, data: { content: r.data.choices?.[0]?.message?.content || "", sources } });
  } catch (err) {
    if (err.response?.status === 429) return res.status(429).json({ error: "Limite do Groq atingido." });
    return res.status(500).json({ error: "Erro no chat.", details: err.message });
  }
});

// ── Preços (sem auth — dado público de mercado) ────────────────
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

// ── Candles (sem auth) ──────────────────────────────────────────
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
// BANCO DE DADOS — todas as rotas abaixo exigem login (requireAuth)
// e usam req.usuarioId (o usuário real logado) em vez de um ID fixo
// ============================================================

// ── Streak de acesso ─────────────────────────────────────────
app.get("/api/streak", requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE usuarios
       SET dias_seguidos = CASE
             WHEN ultimo_acesso = (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN dias_seguidos
             WHEN ultimo_acesso = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 THEN dias_seguidos + 1
             ELSE 1
           END,
           ultimo_acesso = (now() AT TIME ZONE 'America/Sao_Paulo')::date
       WHERE id=$1
       RETURNING dias_seguidos, ultimo_acesso`,
      [req.usuarioId]
    );
    if (!r.rows.length) return res.json({ success: true, data: { diasSeguidos: 0, ultimoAcesso: null } });
    return res.json({ success: true, data: { diasSeguidos: r.rows[0].dias_seguidos, ultimoAcesso: r.rows[0].ultimo_acesso } });
  } catch (err) { return res.status(500).json({ error: "Erro ao atualizar streak.", details: err.message }); }
});

// ── Preferências da Home (personalização) ────────────────────
app.get("/api/preferencias-home", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT preferencias_home FROM usuarios WHERE id=$1`, [req.usuarioId]);
    const prefs = r.rows[0]?.preferencias_home || { mostrarGrafico: true, mostrarAlocacao: true, mostrarTaxas: true };
    return res.json({ success: true, data: prefs });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar preferências.", details: err.message }); }
});

app.post("/api/preferencias-home", requireAuth, async (req, res) => {
  const { mostrarGrafico, mostrarAlocacao, mostrarTaxas } = req.body;
  try {
    const prefs = {
      mostrarGrafico: mostrarGrafico !== false,
      mostrarAlocacao: mostrarAlocacao !== false,
      mostrarTaxas: mostrarTaxas !== false,
    };
    await db.query(`UPDATE usuarios SET preferencias_home=$1 WHERE id=$2`, [JSON.stringify(prefs), req.usuarioId]);
    return res.json({ success: true, data: prefs });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar preferências.", details: err.message }); }
});

// ── Watchlist (ativos favoritos) ──────────────────────────────
app.get("/api/watchlist", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT ticker FROM watchlist WHERE usuario_id=$1 ORDER BY criado_em DESC`, [req.usuarioId]);
    return res.json({ success: true, data: r.rows.map(row => row.ticker) });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar watchlist.", details: err.message }); }
});

app.post("/api/watchlist", requireAuth, async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: "Campo obrigatório: ticker." });
  try {
    await db.query(
      `INSERT INTO watchlist(usuario_id, ticker) VALUES($1,$2) ON CONFLICT (usuario_id, ticker) DO NOTHING`,
      [req.usuarioId, ticker]
    );
    // Cria automaticamente 2 alertas de variação (sobe/cai) pro ativo
    // favoritado, marcados como origem_watchlist=true pra poder limpar
    // sozinho se o usuário desfavoritar depois. O WHERE NOT EXISTS evita
    // duplicar caso essa rota seja chamada 2x pro mesmo ativo. Se der erro
    // aqui, não derruba o favorito em si — só loga, porque favoritar não
    // deveria falhar por causa de um alerta que é só um extra.
    try {
      await db.query(
        `INSERT INTO alertas(usuario_id, ativo, tipo, direcao, valor, email_ativo, origem_watchlist)
         SELECT $1,$2,'variacao_pct','sobe',$3,false,true
         WHERE NOT EXISTS (
           SELECT 1 FROM alertas WHERE usuario_id=$1 AND ativo=$2 AND tipo='variacao_pct' AND direcao='sobe' AND origem_watchlist=true
         )`,
        [req.usuarioId, ticker, LIMIAR_ALERTA_WATCHLIST]
      );
      await db.query(
        `INSERT INTO alertas(usuario_id, ativo, tipo, direcao, valor, email_ativo, origem_watchlist)
         SELECT $1,$2,'variacao_pct','cai',$3,false,true
         WHERE NOT EXISTS (
           SELECT 1 FROM alertas WHERE usuario_id=$1 AND ativo=$2 AND tipo='variacao_pct' AND direcao='cai' AND origem_watchlist=true
         )`,
        [req.usuarioId, ticker, LIMIAR_ALERTA_WATCHLIST]
      );
    } catch (alertErr) {
      console.error("Erro ao criar alerta automático da watchlist:", alertErr.message);
    }
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao adicionar à watchlist.", details: err.message }); }
});

app.delete("/api/watchlist/:ticker", requireAuth, async (req, res) => {
  try {
    await db.query(`DELETE FROM watchlist WHERE usuario_id=$1 AND ticker=$2`, [req.usuarioId, req.params.ticker]);
    // Remove também os alertas automáticos criados quando o ativo foi
    // favoritado. Alertas que o usuário tenha criado manualmente pro mesmo
    // ativo (origem_watchlist=false) não são tocados.
    await db.query(`DELETE FROM alertas WHERE usuario_id=$1 AND ativo=$2 AND origem_watchlist=true`, [req.usuarioId, req.params.ticker]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao remover da watchlist.", details: err.message }); }
});

// ── Painel de Saúde (admin) ───────────────────────────────────
// Diferente do /health simples (usado pelo UptimeRobot a cada 5min, que só
// confirma se as variáveis de ambiente existem), essa rota faz uma chamada
// real em cada serviço externo. Só roda quando alguém abre o painel — não
// entra em monitoramento automático, pra não gastar cota da Brapi/Groq à toa.
app.get("/api/admin/health", requireAuth, async (req, res) => {
  try {
    const adminCheck = await db.query(`SELECT is_admin FROM usuarios WHERE id=$1`, [req.usuarioId]);
    if (!adminCheck.rows[0]?.is_admin) return res.status(403).json({ error: "Acesso restrito a administradores." });
  } catch (e) {
    return res.status(500).json({ error: "Erro ao verificar permissão.", details: e.message });
  }

  const resultado = {};

  const inicioDb = Date.now();
  try {
    const ok = await db.testarConexao();
    resultado.database = { ok, tempoMs: Date.now() - inicioDb, detalhe: ok ? "Conectado" : "Falha na conexão" };
  } catch (e) {
    resultado.database = { ok: false, tempoMs: Date.now() - inicioDb, detalhe: e.message };
  }

  const inicioBrapi = Date.now();
  try {
    if (!BRAPI_TOKEN) throw new Error("BRAPI_TOKEN não configurado");
    const r = await axios.get(`https://brapi.dev/api/quote/PETR4`, { params: { token: BRAPI_TOKEN }, timeout: 8000 });
    const preco = r.data?.results?.[0]?.regularMarketPrice;
    resultado.brapi = { ok: !!preco, tempoMs: Date.now() - inicioBrapi, detalhe: preco ? `PETR4 R$${preco}` : "Resposta sem preço" };
  } catch (e) {
    resultado.brapi = { ok: false, tempoMs: Date.now() - inicioBrapi, detalhe: e.response?.status ? `Erro ${e.response.status}` : e.message };
  }

  const inicioGroq = Date.now();
  try {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY não configurado");
    await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "openai/gpt-oss-120b", max_tokens: 5, temperature: 0,
      messages: [{ role: "user", content: "ping" }],
    }, { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` }, timeout: 10000 });
    resultado.groq = { ok: true, tempoMs: Date.now() - inicioGroq, detalhe: "Respondeu normalmente" };
  } catch (e) {
    resultado.groq = { ok: false, tempoMs: Date.now() - inicioGroq, detalhe: e.response?.status ? `Erro ${e.response.status}` : e.message };
  }

  resultado.supabaseAuth = {
    ok: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
    tempoMs: 0,
    detalhe: (SUPABASE_URL && SUPABASE_ANON_KEY) ? "Configurado (não testável sem token de usuário)" : "Variáveis ausentes",
  };

  return res.json({ success: true, checadoEm: new Date().toISOString(), servicos: resultado });
});

// ── Onboarding (checklist de primeiros passos) ────────────────
app.get("/api/onboarding", requireAuth, async (req, res) => {
  try {
    const [perfil, watch, chat, score, usuario] = await Promise.all([
      db.query(`SELECT 1 FROM perfis_investidor WHERE usuario_id=$1 LIMIT 1`, [req.usuarioId]),
      db.query(`SELECT 1 FROM watchlist WHERE usuario_id=$1 LIMIT 1`, [req.usuarioId]),
      db.query(`SELECT 1 FROM historico_recomendacoes WHERE usuario_id=$1 AND origem='chat' LIMIT 1`, [req.usuarioId]),
      db.query(`SELECT 1 FROM historico_recomendacoes WHERE usuario_id=$1 AND origem='score' LIMIT 1`, [req.usuarioId]),
      db.query(`SELECT onboarding_dispensado FROM usuarios WHERE id=$1`, [req.usuarioId]),
    ]);
    const passos = {
      perfil: perfil.rows.length > 0,
      favorito: watch.rows.length > 0,
      chat: chat.rows.length > 0,
      score: score.rows.length > 0,
    };
    return res.json({ success: true, data: { passos, dispensado: !!usuario.rows[0]?.onboarding_dispensado } });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar progresso.", details: err.message }); }
});

app.post("/api/onboarding/dispensar", requireAuth, async (req, res) => {
  try {
    await db.query(`UPDATE usuarios SET onboarding_dispensado=true WHERE id=$1`, [req.usuarioId]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao dispensar checklist.", details: err.message }); }
});

// ── Perfil ───────────────────────────────────────────────────
app.get("/api/perfil", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM perfis_investidor WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 1`, [req.usuarioId]);
    if (!r.rows.length) return res.json({ success: true, data: null });
    const row = r.rows[0];
    return res.json({ success: true, data: { nome: row.nome, tipoPerfil: row.tipo_perfil, pontuacao: row.pontuacao, capital: parseFloat(row.capital), orcamentoMensal: parseFloat(row.orcamento_mensal), respostas: row.respostas, atualizadoEm: row.atualizado_em } });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar perfil.", details: err.message }); }
});

app.post("/api/perfil", requireAuth, async (req, res) => {
  const { nome, tipoPerfil, pontuacao, capital, orcamentoMensal, respostas } = req.body;
  if (!tipoPerfil || pontuacao === undefined) return res.status(400).json({ error: "Campos obrigatórios: tipoPerfil, pontuacao." });
  try {
    const ex = await db.query(`SELECT id FROM perfis_investidor WHERE usuario_id=$1 LIMIT 1`, [req.usuarioId]);
    if (ex.rows.length) {
      await db.query(`UPDATE perfis_investidor SET nome=$1,tipo_perfil=$2,pontuacao=$3,capital=$4,orcamento_mensal=$5,respostas=$6,atualizado_em=now() WHERE id=$7`,
        [nome||null, tipoPerfil, pontuacao, capital||0, orcamentoMensal||0, respostas?JSON.stringify(respostas):null, ex.rows[0].id]);
    } else {
      await db.query(`INSERT INTO perfis_investidor(usuario_id,nome,tipo_perfil,pontuacao,capital,orcamento_mensal,respostas) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [req.usuarioId, nome||null, tipoPerfil, pontuacao, capital||0, orcamentoMensal||0, respostas?JSON.stringify(respostas):null]);
    }
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar perfil.", details: err.message }); }
});

// ── Conta ────────────────────────────────────────────────────
app.get("/api/conta", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM contas WHERE usuario_id=$1 LIMIT 1`, [req.usuarioId]);
    if (!r.rows.length) return res.json({ success: true, data: null });
    const row = r.rows[0];
    return res.json({ success: true, data: { saldoConta: parseFloat(row.saldo_conta), valorInvestido: parseFloat(row.valor_investido), lancamentosFuturos: parseFloat(row.lancamentos_futuros), corretora: row.corretora, conectado: row.conectado, valorRendaFixa: parseFloat(row.valor_renda_fixa||0), valorRendaVariavel: parseFloat(row.valor_renda_variavel||0), atualizadoEm: row.atualizado_em } });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar conta.", details: err.message }); }
});

app.post("/api/conta", requireAuth, async (req, res) => {
  const { saldoConta, valorInvestido, lancamentosFuturos, corretora, conectado, valorRendaFixa, valorRendaVariavel } = req.body;
  try {
    const ex = await db.query(`SELECT id FROM contas WHERE usuario_id=$1 LIMIT 1`, [req.usuarioId]);
    if (ex.rows.length) {
      await db.query(`UPDATE contas SET saldo_conta=$1,valor_investido=$2,lancamentos_futuros=$3,corretora=$4,conectado=$5,valor_renda_fixa=$6,valor_renda_variavel=$7,atualizado_em=now() WHERE id=$8`,
        [saldoConta||0, valorInvestido||0, lancamentosFuturos||0, corretora||null, conectado||false, valorRendaFixa||0, valorRendaVariavel||0, ex.rows[0].id]);
    } else {
      await db.query(`INSERT INTO contas(usuario_id,saldo_conta,valor_investido,lancamentos_futuros,corretora,conectado,valor_renda_fixa,valor_renda_variavel) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.usuarioId, saldoConta||0, valorInvestido||0, lancamentosFuturos||0, corretora||null, conectado||false, valorRendaFixa||0, valorRendaVariavel||0]);
    }
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar conta.", details: err.message }); }
});

// ── Alertas ──────────────────────────────────────────────────
app.get("/api/alertas", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM alertas WHERE usuario_id=$1 ORDER BY criado_em DESC`, [req.usuarioId]);
    return res.json({ success: true, data: r.rows.map(row => ({ id: row.id, ativo: row.ativo, tipo: row.tipo, direcao: row.direcao, valor: parseFloat(row.valor), emailAtivo: row.email_ativo, ativoFlag: row.ativo_flag, disparado: row.disparado, precoDisparo: row.preco_disparo?parseFloat(row.preco_disparo):null, criadoEm: row.criado_em, disparadoEm: row.disparado_em, origemWatchlist: row.origem_watchlist })) });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar alertas.", details: err.message }); }
});

app.post("/api/alertas", requireAuth, async (req, res) => {
  const { ativo, tipo, direcao, valor, emailAtivo } = req.body;
  if (!ativo||!tipo||valor===undefined) return res.status(400).json({ error: "Campos obrigatórios: ativo, tipo, valor." });
  try {
    const r = await db.query(`INSERT INTO alertas(usuario_id,ativo,tipo,direcao,valor,email_ativo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.usuarioId, ativo, tipo, direcao||null, valor, emailAtivo!==false]);
    return res.json({ success: true, id: r.rows[0].id });
  } catch (err) { return res.status(500).json({ error: "Erro ao criar alerta.", details: err.message }); }
});

app.put("/api/alertas/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { ativoFlag, disparado, precoDisparo } = req.body;
  try {
    const fields = [], values = []; let idx = 1;
    if (ativoFlag!==undefined)    { fields.push(`ativo_flag=$${idx++}`);    values.push(ativoFlag); }
    if (disparado!==undefined)    { fields.push(`disparado=$${idx++}`);     values.push(disparado); }
    if (precoDisparo!==undefined) { fields.push(`preco_disparo=$${idx++}`); values.push(precoDisparo); }
    if (disparado===true)         { fields.push(`disparado_em=now()`); }
    if (!fields.length) return res.status(400).json({ error: "Nenhum campo para atualizar." });
    values.push(id, req.usuarioId);
    await db.query(`UPDATE alertas SET ${fields.join(",")} WHERE id=$${idx++} AND usuario_id=$${idx}`, values);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao atualizar alerta.", details: err.message }); }
});

app.delete("/api/alertas/:id", requireAuth, async (req, res) => {
  try {
    await db.query(`DELETE FROM alertas WHERE id=$1 AND usuario_id=$2`, [req.params.id, req.usuarioId]);
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: "Erro ao remover alerta.", details: err.message }); }
});

// ── Ordens (compra/venda) ───────────────────────────────────
app.post("/api/ordens", requireAuth, async (req, res) => {
  try {
    const { ativo, tipo, quantidade, precoTipo, precoLimite } = req.body;

    if (!ativo || !tipo || !quantidade || !precoTipo) {
      return res.status(400).json({ error: "Campos obrigatórios: ativo, tipo, quantidade, precoTipo" });
    }
    if (!["compra", "venda"].includes(tipo)) {
      return res.status(400).json({ error: "tipo deve ser 'compra' ou 'venda'" });
    }
    if (!["mercado", "limite"].includes(precoTipo)) {
      return res.status(400).json({ error: "precoTipo deve ser 'mercado' ou 'limite'" });
    }
    if (precoTipo === "limite" && !precoLimite) {
      return res.status(400).json({ error: "precoLimite é obrigatório quando precoTipo é 'limite'" });
    }

    const r = await db.query(
      `INSERT INTO ordens(usuario_id, ativo, tipo, quantidade, preco_tipo, preco_limite, status)
       VALUES($1,$2,$3,$4,$5,$6,'pendente') RETURNING *`,
      [req.usuarioId, ativo, tipo, quantidade, precoTipo, precoLimite || null]
    );

    return res.json({ success: true, ordem: r.rows[0] });
  } catch (err) { return res.status(500).json({ error: "Erro ao criar ordem.", details: err.message }); }
});

app.get("/api/ordens", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM ordens WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 100`, [req.usuarioId]);
    return res.json({ success: true, data: r.rows });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar ordens.", details: err.message }); }
});

app.delete("/api/ordens/:id", requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE ordens SET status='cancelada', atualizado_em=now() WHERE id=$1 AND usuario_id=$2 AND status='pendente' RETURNING *`,
      [req.params.id, req.usuarioId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Ordem não encontrada ou já não está mais pendente." });
    return res.json({ success: true, ordem: r.rows[0] });
  } catch (err) { return res.status(500).json({ error: "Erro ao cancelar ordem.", details: err.message }); }
});

// ── Histórico de recomendações ──────────────────────────────────
app.get("/api/historico", requireAuth, async (req, res) => {
  try {
    const r = await db.query(`SELECT * FROM historico_recomendacoes WHERE usuario_id=$1 ORDER BY criado_em DESC LIMIT 100`, [req.usuarioId]);
    return res.json({ success: true, data: r.rows.map(row => ({
      id: row.id, ativo: row.ativo, origem: row.origem, horizonte: row.horizonte,
      recomendacao: row.recomendacao, score: row.score ? parseFloat(row.score) : null,
      precoNoMomento: row.preco_no_momento ? parseFloat(row.preco_no_momento) : null,
      analise: row.analise, criadoEm: row.criado_em,
    })) });
  } catch (err) { return res.status(500).json({ error: "Erro ao buscar histórico.", details: err.message }); }
});

app.post("/api/historico", requireAuth, async (req, res) => {
  const { ativo, origem, horizonte, recomendacao, score, precoNoMomento, analise } = req.body;
  if (!ativo || !origem) return res.status(400).json({ error: "Campos obrigatórios: ativo, origem." });
  try {
    const r = await db.query(
      `INSERT INTO historico_recomendacoes(usuario_id,ativo,origem,horizonte,recomendacao,score,preco_no_momento,analise) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.usuarioId, ativo, origem, horizonte||null, recomendacao||null, score||null, precoNoMomento||null, analise||null]
    );
    return res.json({ success: true, id: r.rows[0].id });
  } catch (err) { return res.status(500).json({ error: "Erro ao salvar histórico.", details: err.message }); }
});

// ── Health (sem auth) ───────────────────────────────────────────
app.get("/health", async (req, res) => {
  const dbOk = await db.testarConexao();
  res.json({ status:"ok", time:new Date().toISOString(), brapi:!!BRAPI_TOKEN, groq:!!GROQ_API_KEY, database:dbOk, security:{ cors:"restrito", rateLimit:`${RATE_LIMIT}/min`, auth:"por usuario" } });
});

app.listen(PORT, () => {
  console.log(`\n✅ Proxy SEGURO na porta ${PORT}`);
  console.log(`🔒 CORS: ${ALLOWED_ORIGIN}`);
  console.log(`🤖 Groq: ${GROQ_API_KEY?"✅":"❌"} | Brapi: ${BRAPI_TOKEN?"✅":"❌"} | DB: ${process.env.DATABASE_URL?"✅":"❌"} | Auth: ${SUPABASE_ANON_KEY?"✅":"❌"}\n`);
});
