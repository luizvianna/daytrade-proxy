import { useState, useEffect, useRef, useCallback } from "react";
import Backtesting from "./Backtesting";
import PaperTrading from "./PaperTrading";
import Login from "./Login";
import Chat from "./Chat";

const PROXY = "https://daytrade-proxy.onrender.com";

const keepProxyAwake = () => {
  const ping = () => fetch(`${PROXY}/health`).catch(() => {});
  ping();
  setInterval(ping, 10 * 60 * 1000);
};

// Ativos expandidos
const ACOES = ["PETR4","VALE3","ITUB4","BBDC4","MGLU3","WEGE3","ABEV3","B3SA3","RENT3","SUZB3","GGBR4","EMBR3","RADL3","EQTL3","SBSP3","VIVT3","LREN3","HAPV3"];
const FIIS  = ["HGLG11","KNRI11","MXRF11","XPML11","BCFF11","VISC11","BRCO11","RBRF11","IRDM11","KNCR11"];
const ETFS  = ["IVVB11","BOVA11","HASH11","SMAL11","DIVO11","GOLD11","XFIX11","FIXA11"];
const CRIPTO = ["BTC-USD","ETH-USD","BNB-USD","SOL-USD","ADA-USD"];

const TODOS_ATIVOS = [...ACOES, ...FIIS, ...ETFS, ...CRIPTO];

const CATEGORIAS = [
  { label: "Ações", ativos: ACOES, cor: "#00e5a0" },
  { label: "FIIs", ativos: FIIS, cor: "#6af" },
  { label: "ETFs", ativos: ETFS, cor: "#ffd60a" },
  { label: "Cripto", ativos: CRIPTO, cor: "#ff9f43" },
];

const INTERVALS = [
  { value: "1m", label: "1m", range: "1d" },
  { value: "5m", label: "5m", range: "5d" },
  { value: "15m", label: "15m", range: "5d" },
  { value: "1h", label: "1h", range: "1mo" },
  { value: "1d", label: "1D", range: "3mo" },
  { value: "1wk", label: "1S", range: "1y" },
  { value: "1mo", label: "1M", range: "5y" },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

function checkSession() {
  try {
    const stored = sessionStorage.getItem("tradeai_auth");
    if (!stored) return false;
    const { expiry } = JSON.parse(stored);
    if (Date.now() > expiry) { sessionStorage.removeItem("tradeai_auth"); return false; }
    return true;
  } catch { return false; }
}

function CandleChart({ candles, width = 600, height = 180 }) {
  if (!candles || candles.length === 0) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>Carregando...</div>
  );
  const last = candles.slice(-50);
  const pad = { l: 8, r: 8, t: 10, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const prices = last.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const cw = w / last.length;
  const py = p => pad.t + h - ((p - minP) / range) * h;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      {last.map((c, i) => {
        const x = pad.l + i * cw + cw * 0.1;
        const bw = Math.max(1, cw * 0.8);
        const isUp = c.close >= c.open;
        const color = isUp ? "#00e5a0" : "#ff4d6d";
        const bodyTop = py(Math.max(c.open, c.close));
        const bodyH = Math.max(1, py(Math.min(c.open, c.close)) - bodyTop);
        const cx = x + bw / 2;
        return (
          <g key={i}>
            <line x1={cx} y1={py(c.high)} x2={cx} y2={py(c.low)} stroke={color} strokeWidth="1" />
            <rect x={x} y={bodyTop} width={bw} height={bodyH} fill={color} rx="1" />
          </g>
        );
      })}
      <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#ffffff18" />
    </svg>
  );
}

function Badge({ type }) {
  const map = {
    COMPRA:   { bg: "#00e5a022", border: "#00e5a0", text: "#00e5a0", label: "▲ COMPRA" },
    VENDA:    { bg: "#ff4d6d22", border: "#ff4d6d", text: "#ff4d6d", label: "▼ VENDA" },
    AGUARDAR: { bg: "#ffd60a22", border: "#ffd60a", text: "#ffd60a", label: "◆ AGUARDAR" },
  };
  const s = map[type] || map.AGUARDAR;
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontWeight: "700", fontFamily: "monospace" }}>
      {s.label}
    </span>
  );
}

function Dashboard() {
  const isMobile = useIsMobile();
  const [categoria, setCategoria] = useState("Ações");
  const [asset, setAsset] = useState("PETR4");
  const [interval, setInterval] = useState("5m");
  const [candles, setCandles] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange, setPriceChange] = useState(null);
  const [allPrices, setAllPrices] = useState({});
  const [stopLoss, setStopLoss] = useState("1.5");
  const [takeProfit, setTakeProfit] = useState("3.0");
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [stats, setStats] = useState({ ops: 0, wins: 0, pnl: 0 });
  const [lastUpdate, setLastUpdate] = useState(null);
  const [showPrices, setShowPrices] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const candlesRef = useRef([]);
  const priceRef = useRef(null);
  candlesRef.current = candles;
  priceRef.current = currentPrice;

  const ativosCategoria = CATEGORIAS.find(c => c.label === categoria)?.ativos || ACOES;
  const corCategoria = CATEGORIAS.find(c => c.label === categoria)?.cor || "#00e5a0";

  const fetchCandles = useCallback(async (assetName, iv) => {
    setLoadingData(true);
    try {
      const ivConf = INTERVALS.find(i => i.value === iv);
      const res = await fetch(`${PROXY}/api/candles?ticker=${assetName}&interval=${iv}&range=${ivConf?.range || "1d"}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCandles(data.candles);
      setCurrentPrice(data.currentPrice);
      setPriceChange(data.currentPrice && data.previousClose ? ((data.currentPrice - data.previousClose) / data.previousClose * 100) : null);
      setLastUpdate(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }, []);

  const fetchAllPrices = useCallback(async () => {
    try {
      const res = await fetch(`${PROXY}/api/prices?tickers=${TODOS_ATIVOS.slice(0, 20).join(",")}`);
      setAllPrices(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    setCandles([]); setCurrentPrice(null);
    fetchCandles(asset, interval);
  }, [asset, interval, fetchCandles]);

  const analyzeWithAI = useCallback(async () => {
    const cands = candlesRef.current;
    const price = priceRef.current;
    if (!cands.length || !price) return;
    setLoadingAI(true);
    try {
      const last20 = cands.slice(-20);
      const bullCandles = last20.filter(c => c.close > c.open).length;
      const trend = bullCandles >= 12 ? "ALTA" : bullCandles <= 8 ? "BAIXA" : "LATERAL";
      const lastC = cands[cands.length - 1];
      const isCripto = CRIPTO.includes(asset);
      const isFII = FIIS.includes(asset);
      const isETF = ETFS.includes(asset);

      const response = await fetch(`${PROXY}/api/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: `Você é um analista de investimentos especialista em ${isCripto ? "criptomoedas" : isFII ? "FIIs brasileiros" : isETF ? "ETFs" : "ações da B3"}. Responda APENAS JSON válido.`,
          prompt: `Ativo: ${asset} | Tipo: ${isCripto ? "Cripto" : isFII ? "FII" : isETF ? "ETF" : "Ação"} | Preço: R$${price.toFixed(2)} | Tendência: ${trend} (${bullCandles}/20) | Último candle: A${lastC.open.toFixed(2)} F${lastC.close.toFixed(2)} | SL: ${stopLoss}% | TP: ${takeProfit}% | Timeframe: ${interval}
Analise e responda: {"signal":"COMPRA|VENDA|AGUARDAR","confidence":0-100,"bestInterval":"1m|5m|15m|1h|1d|1wk|1mo","intervalReason":"motivo","reasoning":"análise completa em 2 frases","entry":${price},"sl":${(price*(1-parseFloat(stopLoss)/100)).toFixed(2)},"tp":${(price*(1+parseFloat(takeProfit)/100)).toFixed(2)},"horizonte":"${isCripto||isETF ? "curto/médio" : isFII ? "longo prazo" : "daytrade/swing"}","score":0-10}`
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Erro na IA");
      const parsed = data.data;
      const time = new Date().toLocaleTimeString("pt-BR");

      const newLog = { id: Date.now(), time, asset, signal: parsed.signal, price, confidence: parsed.confidence, bestInterval: parsed.bestInterval, reasoning: `[${parsed.confidence}% | ${parsed.bestInterval} | Score:${parsed.score}/10] ${parsed.reasoning}`, entry: parsed.entry || price, sl: parsed.sl, tp: parsed.tp, horizonte: parsed.horizonte };
      setLogs(prev => [newLog, ...prev].slice(0, 20));
      setLastAnalysis(parsed);
      setStats(prev => ({ ops: prev.ops + 1, wins: prev.wins + (parsed.signal !== "AGUARDAR" && parsed.confidence > 65 ? 1 : 0), pnl: prev.pnl + (parsed.signal === "COMPRA" ? (Math.random() * 2 - 0.4) : 0) }));
      if (parsed.bestInterval && parsed.bestInterval !== interval) setInterval(parsed.bestInterval);
    } catch (e) { console.error(e); }
    finally { setLoadingAI(false); }
  }, [asset, interval, stopLoss, takeProfit]);

  useEffect(() => {
    if (!running) return;
    const d = setInterval(() => { fetchCandles(asset, interval); fetchAllPrices(); }, 60000);
    const a = setInterval(() => analyzeWithAI(), 45000);
    fetchAllPrices(); analyzeWithAI();
    return () => { clearInterval(d); clearInterval(a); };
  }, [running, asset, interval]);

  const priceColor = priceChange === null ? "#fff" : priceChange >= 0 ? "#00e5a0" : "#ff4d6d";
  const winRate = stats.ops > 0 ? ((stats.wins / stats.ops) * 100).toFixed(1) : "0.0";

  return (
    <div style={{ padding: isMobile ? "12px" : "20px", maxWidth: "1200px", margin: "0 auto" }}>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: "10px", marginBottom: "14px" }}>
        {[
          { label: "PREÇO", value: currentPrice ? `R$ ${currentPrice.toFixed(2)}` : "...", sub: priceChange !== null ? `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%` : "", color: priceColor },
          { label: "OPERAÇÕES", value: stats.ops, sub: "analisadas", color: "#fff" },
          { label: "WIN RATE", value: `${winRate}%`, sub: `${stats.wins}W`, color: parseFloat(winRate) > 50 ? "#00e5a0" : "#ff4d6d" },
          { label: "SCORE IA", value: lastAnalysis?.score !== undefined ? `${lastAnalysis.score}/10` : "—", sub: lastAnalysis?.horizonte || "aguardando", color: "#ffd60a" },
        ].map((s, i) => (
          <div key={i} style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "10px", padding: "12px 14px" }}>
            <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "4px" }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: isMobile ? "18px" : "22px", fontWeight: "700" }}>{s.value}</div>
            <div style={{ color: "#444", fontSize: "10px", marginTop: "2px" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "300px 1fr", gap: "14px" }}>
        <div>
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "12px", padding: "16px", marginBottom: "12px" }}>
            <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "12px" }}>CONFIGURAÇÃO</div>

            {/* Categorias */}
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", color: "#666", fontSize: "11px", marginBottom: "6px" }}>Categoria</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "4px" }}>
                {CATEGORIAS.map(cat => (
                  <button key={cat.label} onClick={() => { setCategoria(cat.label); setAsset(cat.ativos[0]); }}
                    style={{ background: categoria === cat.label ? `${cat.cor}22` : "#111a27", border: `1px solid ${categoria === cat.label ? cat.cor : "#1e2d45"}`, color: categoria === cat.label ? cat.cor : "#555", borderRadius: "6px", padding: "6px 4px", fontSize: "10px", fontWeight: "700", cursor: "pointer" }}>
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Ativo */}
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", color: "#666", fontSize: "11px", marginBottom: "4px" }}>Ativo</label>
              <select value={asset} onChange={e => setAsset(e.target.value)} disabled={running}
                style={{ width: "100%", background: "#111a27", border: `1px solid ${corCategoria}44`, color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "monospace" }}>
                {ativosCategoria.map(a => <option key={a} value={a}>{a} {allPrices[a] ? `· R$${allPrices[a].price?.toFixed(2)}` : ""}</option>)}
              </select>
            </div>

            {/* Timeframe */}
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", color: "#666", fontSize: "11px", marginBottom: "4px" }}>Timeframe</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "3px" }}>
                {INTERVALS.map(iv => (
                  <button key={iv.value} onClick={() => setInterval(iv.value)}
                    style={{ background: interval === iv.value ? `${corCategoria}22` : "#111a27", border: `1px solid ${interval === iv.value ? corCategoria : "#1e2d45"}`, color: interval === iv.value ? corCategoria : "#555", borderRadius: "5px", padding: "6px 2px", fontSize: "9px", fontWeight: "600", cursor: "pointer" }}>
                    {iv.label}
                  </button>
                ))}
              </div>
            </div>

            {/* SL e TP */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              {[{ label: "Stop Loss %", val: stopLoss, set: setStopLoss }, { label: "Take Profit %", val: takeProfit, set: setTakeProfit }].map((f, i) => (
                <div key={i}>
                  <label style={{ display: "block", color: "#666", fontSize: "11px", marginBottom: "4px" }}>{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)} disabled={running} step="0.1"
                    style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "monospace" }} />
                </div>
              ))}
            </div>

            <button onClick={() => setRunning(r => !r)}
              style={{ width: "100%", marginBottom: "8px", background: running ? "#ff4d6d22" : `linear-gradient(135deg,${corCategoria},#006eff)`, color: running ? "#ff4d6d" : "#000", border: running ? "1px solid #ff4d6d55" : "none", borderRadius: "10px", padding: "13px", fontSize: "15px", fontWeight: "700", cursor: "pointer" }}>
              {running ? "⏹ PARAR IA" : "▶ INICIAR IA"}
            </button>
            <button onClick={() => fetchCandles(asset, interval)}
              style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#888", borderRadius: "8px", padding: "9px", fontSize: "12px", cursor: "pointer" }}>
              🔄 Atualizar
            </button>
          </div>

          {/* Último sinal */}
          {logs[0] && (
            <div style={{ background: "#0d1320", border: `1px solid ${logs[0].signal === "COMPRA" ? "#00e5a044" : logs[0].signal === "VENDA" ? "#ff4d6d44" : "#ffd60a44"}`, borderRadius: "12px", padding: "14px", marginBottom: "12px" }}>
              <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "8px" }}>ÚLTIMO SINAL</div>
              <div style={{ marginBottom: "6px" }}><Badge type={logs[0].signal} /></div>
              <p style={{ color: "#bbb", fontSize: "12px", lineHeight: "1.6", margin: 0 }}>{logs[0].reasoning}</p>
              {logs[0].horizonte && <div style={{ color: "#555", fontSize: "10px", marginTop: "6px", fontFamily: "monospace" }}>📅 {logs[0].horizonte}</div>}
            </div>
          )}

          {/* Mercado por categoria */}
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "12px", padding: "14px" }}>
            <button onClick={() => setShowPrices(p => !p)}
              style={{ width: "100%", background: "none", border: "none", color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", cursor: "pointer", display: "flex", justifyContent: "space-between", padding: 0 }}>
              <span>MERCADO AO VIVO ⚡</span><span>{showPrices ? "▲" : "▼"}</span>
            </button>
            {(showPrices || !isMobile) && (
              <div style={{ marginTop: "10px" }}>
                {ativosCategoria.slice(0, 8).map(a => {
                  const p = allPrices[a];
                  return (
                    <div key={a} onClick={() => setAsset(a)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #0d1827", cursor: "pointer" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", color: a === asset ? corCategoria : "#888", fontWeight: a === asset ? "700" : "400" }}>{a}</span>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "monospace", fontSize: "12px", color: "#ccc" }}>{p?.price ? `R$ ${p.price.toFixed(2)}` : "..."}</div>
                        {p?.change !== undefined && <div style={{ fontSize: "10px", color: p.change >= 0 ? "#00e5a0" : "#ff4d6d" }}>{p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div>
          {/* Gráfico */}
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "12px", padding: "16px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: corCategoria, fontSize: "10px", fontFamily: "monospace", background: `${corCategoria}22`, border: `1px solid ${corCategoria}44`, borderRadius: "4px", padding: "2px 6px" }}>{categoria}</span>
                  <span style={{ color: "#444", fontSize: "9px", fontFamily: "monospace" }}>{asset} · {INTERVALS.find(i => i.value === interval)?.label}</span>
                </div>
                <div style={{ color: priceColor, fontSize: isMobile ? "20px" : "24px", fontWeight: "700", fontFamily: "monospace", marginTop: "4px" }}>{currentPrice ? `R$ ${currentPrice.toFixed(2)}` : "..."}</div>
                {lastUpdate && <div style={{ color: "#333", fontSize: "10px", fontFamily: "monospace" }}>{lastUpdate}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                {loadingData && <div style={{ color: "#555", fontSize: "11px" }}>🔄</div>}
                {loadingAI && <div style={{ color: corCategoria, fontSize: "11px" }}>🤖 analisando...</div>}
              </div>
            </div>
            <CandleChart candles={candles} width={isMobile ? 340 : 700} height={isMobile ? 140 : 200} />
          </div>

          {/* Log */}
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "12px", padding: "16px", maxHeight: isMobile ? "280px" : "350px", overflowY: "auto" }}>
            <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "12px" }}>
              LOG DE ANÁLISES {logs.length > 0 && `(${logs.length})`}
            </div>
            {logs.length === 0 ? (
              <div style={{ color: "#2a2a2a", fontSize: "13px", textAlign: "center", padding: "30px 0" }}>{running ? "Aguardando análise..." : "Inicie a IA para ver os sinais"}</div>
            ) : logs.map(l => (
              <div key={l.id} style={{ borderLeft: `3px solid ${l.signal === "COMPRA" ? "#00e5a0" : l.signal === "VENDA" ? "#ff4d6d" : "#ffd60a"}`, paddingLeft: "10px", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", flexWrap: "wrap" }}>
                  <span style={{ color: "#555", fontSize: "10px", fontFamily: "monospace" }}>{l.time}</span>
                  <Badge type={l.signal} />
                  <span style={{ color: "#fff", fontWeight: "700", fontSize: "12px" }}>{l.asset}</span>
                  <span style={{ color: "#aaa", fontSize: "11px" }}>R$ {l.price?.toFixed(2)}</span>
                </div>
                <p style={{ color: "#ccc", fontSize: "11px", lineHeight: "1.6", margin: 0 }}>{l.reasoning}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: "12px", padding: "10px 14px", background: "#0d1320", border: "1px solid #ff4d6d22", borderRadius: "10px" }}>
        <span style={{ color: "#555", fontSize: "11px" }}>⚠️ Sistema educacional. Ações · FIIs · ETFs · Cripto · Dados: Brapi ⚡ + Yahoo Finance</span>
      </div>
    </div>
  );
}

export default function App() {
  const [autenticado, setAutenticado] = useState(checkSession);
  const [page, setPage] = useState("dashboard");
  const [proxyOk, setProxyOk] = useState(null);
  const [proxyWaking, setProxyWaking] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!autenticado) return;
    keepProxyAwake();
    const check = () => {
      fetch(`${PROXY}/health`)
        .then(r => r.json())
        .then(() => { setProxyOk(true); setProxyWaking(false); })
        .catch(() => { setProxyOk(false); setProxyWaking(true); });
    };
    check();
    const i = setInterval(check, 15000);
    return () => clearInterval(i);
  }, [autenticado]);

  const handleLogout = () => { sessionStorage.removeItem("tradeai_auth"); setAutenticado(false); };

  if (!autenticado) return <Login onLogin={() => setAutenticado(true)} />;

  const PAGES = [
    { id: "dashboard",    label: isMobile ? "📈" : "📈 Dashboard" },
    { id: "chat",         label: isMobile ? "💬" : "💬 Chat IA" },
    { id: "backtesting",  label: isMobile ? "📊" : "📊 Backtesting" },
    { id: "papertrading", label: isMobile ? "🏦" : "🏦 Paper Trading" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#e0e6f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        select, input, textarea { outline: none; }
        .pulse { animation: pulse 2s infinite; } @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
      `}</style>

      {/* Header */}
      <div style={{ background: "#0a0f1a", borderBottom: "1px solid #1e2d45", padding: isMobile ? "10px 14px" : "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "28px", height: "28px", background: "linear-gradient(135deg,#00e5a0,#006eff)", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>⚡</div>
          {!isMobile && <div style={{ fontWeight: "700", fontSize: "14px" }}>TRADE<span style={{ color: "#00e5a0" }}>AI</span></div>}
        </div>

        {/* Navegação */}
        <div style={{ display: "flex", gap: "2px", background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "10px", padding: "3px" }}>
          {PAGES.map(nav => (
            <button key={nav.id} onClick={() => setPage(nav.id)}
              style={{ background: page === nav.id ? "#00e5a015" : "transparent", border: page === nav.id ? "1px solid #00e5a033" : "1px solid transparent", color: page === nav.id ? "#00e5a0" : "#555", borderRadius: "7px", padding: isMobile ? "7px 10px" : "7px 14px", fontSize: isMobile ? "15px" : "12px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit" }}>
              {nav.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: proxyOk === null ? "#555" : proxyOk ? "#00e5a0" : "#ffd60a" }} className={proxyWaking ? "pulse" : ""} />
            {!isMobile && <span style={{ color: proxyOk ? "#00e5a0" : "#ffd60a", fontSize: "10px", fontFamily: "monospace" }}>{proxyOk ? "ONLINE" : "ACORDANDO..."}</span>}
          </div>
          <button onClick={handleLogout}
            style={{ background: "#ff4d6d15", border: "1px solid #ff4d6d33", color: "#ff4d6d", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: "pointer" }}>
            🔒{!isMobile && " Sair"}
          </button>
        </div>
      </div>

      {proxyWaking && (
        <div style={{ background: "#ffd60a11", border: "1px solid #ffd60a33", margin: "10px 14px", borderRadius: "10px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="pulse">⏳</span>
          <span style={{ color: "#ffd60a", fontSize: "12px" }}>Servidor acordando... Aguarde até 60 segundos.</span>
        </div>
      )}

      <div style={{ display: page === "dashboard"    ? "block" : "none" }}><Dashboard /></div>
      <div style={{ display: page === "chat"         ? "block" : "none" }}><Chat /></div>
      <div style={{ display: page === "backtesting"  ? "block" : "none" }}><Backtesting /></div>
      <div style={{ display: page === "papertrading" ? "block" : "none" }}><PaperTrading /></div>
    </div>
  );
}
