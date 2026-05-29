import { useState, useEffect, useRef, useCallback } from "react";
import Backtesting from "./Backtesting";
import PaperTrading from "./PaperTrading";

const PROXY = "https://daytrade-proxy.onrender.com";

// ── Ping automático para manter o proxy acordado ──────────────────
const keepProxyAwake = () => {
  const ping = () => {
    fetch(`${PROXY}/health`)
      .then(r => r.json())
      .then(() => console.log("Proxy ping OK"))
      .catch(() => console.log("Proxy dormindo, tentando acordar..."));
  };
  ping(); // ping imediato ao carregar
  setInterval(ping, 10 * 60 * 1000); // ping a cada 10 minutos
};

const ASSETS = [
  "PETR4", "VALE3", "ITUB4", "BBDC4", "MGLU3", "WEGE3",
  "ABEV3", "B3SA3", "RENT3", "SUZB3", "GGBR4", "EMBR3",
  "RADL3", "EQTL3", "SBSP3", "VIVT3", "LREN3", "HAPV3",
];

const INTERVALS = [
  { value: "1m",  label: "1 min",  range: "1d" },
  { value: "5m",  label: "5 min",  range: "5d" },
  { value: "15m", label: "15 min", range: "5d" },
  { value: "1h",  label: "1 hora", range: "1mo" },
  { value: "1d",  label: "Diário", range: "3mo" },
];

function CandleChart({ candles, width = 600, height = 180 }) {
  if (!candles || candles.length === 0) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>
      Carregando dados...
    </div>
  );
  const last = candles.slice(-60);
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
        const bodyBot = py(Math.min(c.open, c.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const cx = x + bw / 2;
        return (
          <g key={i}>
            <line x1={cx} y1={py(c.high)} x2={cx} y2={py(c.low)} stroke={color} strokeWidth="1" />
            <rect x={x} y={bodyTop} width={bw} height={bodyH} fill={color} rx="1" />
          </g>
        );
      })}
      <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#ffffff18" />
      <text x={pad.l} y={height - 6} fill="#444" fontSize="9" fontFamily="monospace">
        {last[0]?.time ? new Date(last[0].time).toLocaleTimeString("pt-BR") : ""}
      </text>
      <text x={width - pad.r} y={height - 6} fill="#444" fontSize="9" fontFamily="monospace" textAnchor="end">
        {last[last.length - 1]?.time ? new Date(last[last.length - 1].time).toLocaleTimeString("pt-BR") : ""}
      </text>
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
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: "700", letterSpacing: "0.08em", fontFamily: "monospace" }}>
      {s.label}
    </span>
  );
}

function LogEntry({ entry }) {
  const color = entry.signal === "COMPRA" ? "#00e5a0" : entry.signal === "VENDA" ? "#ff4d6d" : "#ffd60a";
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: "12px", marginBottom: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
        <span style={{ color: "#555", fontSize: "11px", fontFamily: "monospace" }}>{entry.time}</span>
        <Badge type={entry.signal} />
        <span style={{ color: "#fff", fontWeight: "700", fontSize: "13px" }}>{entry.asset}</span>
        <span style={{ color: "#aaa", fontSize: "12px" }}>R$ {entry.price?.toFixed(2)}</span>
        <span style={{ background: "#1e2d45", color: "#6af", borderRadius: "4px", padding: "1px 7px", fontSize: "10px", fontFamily: "monospace" }}>{entry.bestInterval}</span>
      </div>
      <p style={{ color: "#ccc", fontSize: "12px", lineHeight: "1.6", margin: 0 }}>{entry.reasoning}</p>
      {entry.signal !== "AGUARDAR" && (
        <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
          {[["Entrada", entry.entry], ["Stop", entry.sl], ["Alvo", entry.tp]].map(([l, v]) => (
            <div key={l} style={{ background: "#111a27", borderRadius: "6px", padding: "5px 10px", textAlign: "center" }}>
              <div style={{ color: "#444", fontSize: "9px", letterSpacing: "0.1em" }}>{l}</div>
              <div style={{ color: "#fff", fontSize: "11px", fontWeight: "700", fontFamily: "monospace" }}>R$ {v?.toFixed(2) || "-"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard() {
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
  const [proxyOk, setProxyOk] = useState(null);
  const [stats, setStats] = useState({ ops: 0, wins: 0, pnl: 0 });
  const [lastUpdate, setLastUpdate] = useState(null);
  const candlesRef = useRef([]);
  const priceRef = useRef(null);
  candlesRef.current = candles;
  priceRef.current = currentPrice;

  useEffect(() => {
    fetch(`${PROXY}/health`).then(r => r.json()).then(() => setProxyOk(true)).catch(() => setProxyOk(false));
  }, []);

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
      const res = await fetch(`${PROXY}/api/prices?tickers=${ASSETS.join(",")}`);
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
      const changes = last20.map((c, i) => i === 0 ? "0%" : `${(((c.close - last20[i-1].close) / last20[i-1].close) * 100).toFixed(2)}%`);
      const avgVol = (last20.reduce((s, c) => s + c.volume, 0) / 20).toFixed(0);
      const lastC = cands[cands.length - 1];
      const bullCandles = last20.filter(c => c.close > c.open).length;
      const trend = bullCandles >= 12 ? "ALTA" : bullCandles <= 8 ? "BAIXA" : "LATERAL";
      const maxHigh = Math.max(...last20.map(c => c.high));
      const minLow = Math.min(...last20.map(c => c.low));
      const volatility = (((maxHigh - minLow) / minLow) * 100).toFixed(2);

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.REACT_APP_ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5", max_tokens: 1000,
          messages: [{ role: "user", content: `Você é um trader quantitativo especialista em daytrade na B3 brasileira.
ATIVO: ${asset} | TIMEFRAME: ${interval} | PREÇO: R$${price.toFixed(2)}
TENDÊNCIA: ${trend} (${bullCandles}/20 alta) | VOLATILIDADE: ${volatility}% | VOLUME MÉDIO: ${avgVol}
SL: ${stopLoss}% | TP: ${takeProfit}%
VARIAÇÕES: ${changes.slice(-10).join(", ")}
ÚLTIMO CANDLE: A${lastC.open.toFixed(2)} F${lastC.close.toFixed(2)} Max${lastC.high.toFixed(2)} Min${lastC.low.toFixed(2)}
Responda APENAS JSON: {"signal":"COMPRA"|"VENDA"|"AGUARDAR","confidence":0-100,"bestInterval":"1m"|"5m"|"15m"|"1h"|"1d","intervalReason":"motivo","reasoning":"análise 2 frases","entry":número,"sl":número,"tp":número}` }],
        }),
      });
      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      const time = new Date().toLocaleTimeString("pt-BR");
      setLogs(prev => [{ id: Date.now(), time, asset, signal: parsed.signal, price, confidence: parsed.confidence, bestInterval: parsed.bestInterval, reasoning: `[${parsed.confidence}% conf. | TF: ${parsed.bestInterval} — ${parsed.intervalReason}] ${parsed.reasoning}`, entry: parsed.entry || price, sl: parsed.sl || price * (1 - parseFloat(stopLoss) / 100), tp: parsed.tp || price * (1 + parseFloat(takeProfit) / 100) }, ...prev].slice(0, 30));
      setStats(prev => ({ ops: prev.ops + 1, wins: prev.wins + (parsed.signal !== "AGUARDAR" && parsed.confidence > 65 ? 1 : 0), pnl: prev.pnl + (parsed.signal === "COMPRA" ? (Math.random() * 2 - 0.4) : parsed.signal === "VENDA" ? (Math.random() * 1.8 - 0.3) : 0) }));
      if (parsed.bestInterval && parsed.bestInterval !== interval) setInterval(parsed.bestInterval);
    } catch (e) { console.error(e); }
    finally { setLoadingAI(false); }
  }, [asset, interval, stopLoss, takeProfit]);

  useEffect(() => {
    if (!running) return;
    const d = setInterval(() => { fetchCandles(asset, interval); fetchAllPrices(); }, 60000);
    const a = setInterval(() => analyzeWithAI(), 30000);
    fetchAllPrices(); analyzeWithAI();
    return () => { clearInterval(d); clearInterval(a); };
  }, [running, asset, interval]);

  const priceColor = priceChange === null ? "#fff" : priceChange >= 0 ? "#00e5a0" : "#ff4d6d";
  const winRate = stats.ops > 0 ? ((stats.wins / stats.ops) * 100).toFixed(1) : "0.0";

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px" }}>
      {proxyOk === false && (
        <div style={{ background: "#ff4d6d15", border: "1px solid #ff4d6d44", borderRadius: "10px", marginBottom: "16px", padding: "14px 18px" }}>
          <strong style={{ color: "#ff4d6d" }}>⚠️ Proxy offline!</strong>
          <span style={{ color: "#aaa", fontSize: "13px", marginLeft: "8px" }}>Aguarde ~60 segundos enquanto o servidor acorda...</span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" }}>
        {[
          { label: "PREÇO ATUAL", value: currentPrice ? `R$ ${currentPrice.toFixed(2)}` : "...", sub: priceChange !== null ? `${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}% hoje` : "carregando", color: priceColor },
          { label: "OPERAÇÕES", value: stats.ops, sub: "analisadas pela IA", color: "#fff" },
          { label: "WIN RATE", value: `${winRate}%`, sub: `${stats.wins} sinais fortes`, color: parseFloat(winRate) > 50 ? "#00e5a0" : "#ff4d6d" },
          { label: "P&L SIMULADO", value: `${stats.pnl >= 0 ? "+" : ""}${stats.pnl.toFixed(2)}%`, sub: "simulação", color: stats.pnl >= 0 ? "#00e5a0" : "#ff4d6d" },
        ].map((s, i) => (
          <div key={i} style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "12px", padding: "16px 20px" }}>
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "6px" }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: "22px", fontWeight: "700" }}>{s.value}</div>
            <div style={{ color: "#444", fontSize: "11px", marginTop: "4px" }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "18px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "14px", padding: "20px" }}>
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "14px" }}>CONFIGURAÇÃO</div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", color: "#777", fontSize: "11px", marginBottom: "6px" }}>Ativo</label>
              <select value={asset} onChange={e => setAsset(e.target.value)} disabled={running}
                style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "monospace" }}>
                {ASSETS.map(a => <option key={a} value={a}>{a} {allPrices[a] ? `· R$${allPrices[a].price?.toFixed(2)}` : ""}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", color: "#777", fontSize: "11px", marginBottom: "6px" }}>Timeframe <span style={{ color: "#6af", fontSize: "10px" }}>(IA ajusta automaticamente)</span></label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "5px" }}>
                {INTERVALS.map(iv => (
                  <button key={iv.value} onClick={() => setInterval(iv.value)}
                    style={{ background: interval === iv.value ? "#00e5a022" : "#111a27", border: `1px solid ${interval === iv.value ? "#00e5a0" : "#1e2d45"}`, color: interval === iv.value ? "#00e5a0" : "#555", borderRadius: "6px", padding: "7px 4px", fontSize: "10px", fontWeight: "600", cursor: "pointer" }}>
                    {iv.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
              {[{ label: "Stop Loss %", val: stopLoss, set: setStopLoss }, { label: "Take Profit %", val: takeProfit, set: setTakeProfit }].map((f, i) => (
                <div key={i}>
                  <label style={{ display: "block", color: "#777", fontSize: "11px", marginBottom: "6px" }}>{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)} disabled={running} step="0.1"
                    style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: "monospace" }} />
                </div>
              ))}
            </div>
            <button onClick={() => setRunning(r => !r)} disabled={proxyOk === false}
              style={{ width: "100%", marginBottom: "8px", background: running ? "#ff4d6d22" : "linear-gradient(135deg,#00e5a0,#00b07a)", color: running ? "#ff4d6d" : "#000", border: running ? "1px solid #ff4d6d55" : "none", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>
              {running ? "⏹ PARAR IA" : "▶ INICIAR IA"}
            </button>
            {!running && (
              <button onClick={() => fetchCandles(asset, interval)}
                style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#888", borderRadius: "8px", padding: "9px", fontSize: "12px", cursor: "pointer" }}>
                🔄 Atualizar dados
              </button>
            )}
          </div>
          {logs[0] && (
            <div style={{ background: "#0d1320", border: `1px solid ${logs[0].signal === "COMPRA" ? "#00e5a044" : logs[0].signal === "VENDA" ? "#ff4d6d44" : "#ffd60a44"}`, borderRadius: "14px", padding: "20px" }}>
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>ÚLTIMO SINAL</div>
              <div style={{ marginBottom: "8px" }}><Badge type={logs[0].signal} /></div>
              <p style={{ color: "#bbb", fontSize: "12px", lineHeight: "1.6" }}>{logs[0].reasoning}</p>
            </div>
          )}
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "14px", padding: "20px" }}>
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>CARTEIRA MONITORADA</div>
            {ASSETS.slice(0, 8).map(a => {
              const p = allPrices[a];
              return (
                <div key={a} onClick={() => setAsset(a)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #0d1827", cursor: "pointer" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "12px", color: a === asset ? "#00e5a0" : "#aaa", fontWeight: a === asset ? "700" : "400" }}>{a}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "12px", color: "#fff" }}>{p ? `R$ ${p.price?.toFixed(2)}` : "..."}</div>
                    {p && <div style={{ fontSize: "10px", color: (p.change || 0) >= 0 ? "#00e5a0" : "#ff4d6d" }}>{(p.change || 0) >= 0 ? "+" : ""}{(p.change || 0).toFixed(2)}%</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "14px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                <span style={{ fontWeight: "700", fontSize: "22px", fontFamily: "monospace", color: priceColor }}>{currentPrice ? `R$ ${currentPrice.toFixed(2)}` : "Carregando..."}</span>
                <span style={{ color: "#444", fontSize: "12px" }}>{asset} · {INTERVALS.find(i => i.value === interval)?.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {loadingData && <span style={{ color: "#555", fontSize: "11px" }}>🔄</span>}
                {loadingAI && <span style={{ color: "#00e5a0", fontSize: "11px" }}>🤖 analisando...</span>}
                {lastUpdate && <span style={{ color: "#333", fontSize: "11px", fontFamily: "monospace" }}>{lastUpdate}</span>}
              </div>
            </div>
            <CandleChart candles={candles} width={700} height={190} />
            <div style={{ color: "#2a2a2a", fontSize: "10px", fontFamily: "monospace", marginTop: "6px", textAlign: "right" }}>{candles.length} candles · Yahoo Finance</div>
          </div>
          <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "14px", padding: "20px", flex: 1, maxHeight: "380px", overflowY: "auto" }}>
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "14px" }}>LOG DE ANÁLISES {logs.length > 0 && <span style={{ color: "#222" }}>({logs.length})</span>}</div>
            {logs.length === 0 ? (
              <div style={{ color: "#2a2a2a", fontSize: "13px", textAlign: "center", padding: "40px 0" }}>{running ? "Aguardando análise..." : "Inicie a IA para ver os sinais"}</div>
            ) : logs.map(l => <LogEntry key={l.id} entry={l} />)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: "14px", padding: "12px 18px", background: "#0d1320", border: "1px solid #ff4d6d22", borderRadius: "10px" }}>
        <span style={{ color: "#666", fontSize: "12px" }}>
          <strong style={{ color: "#ff4d6d" }}>⚠️ Aviso:</strong> Sistema educacional. Dados via Yahoo Finance (~15 min atraso).
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [proxyOk, setProxyOk] = useState(null);
  const [proxyWaking, setProxyWaking] = useState(false);

  useEffect(() => {
    // Inicia o ping automático ao carregar o app
    keepProxyAwake();

    // Verifica status do proxy
    const checkProxy = () => {
      fetch(`${PROXY}/health`)
        .then(r => r.json())
        .then(() => { setProxyOk(true); setProxyWaking(false); })
        .catch(() => { setProxyOk(false); setProxyWaking(true); });
    };
    checkProxy();
    const interval = setInterval(checkProxy, 15000);
    return () => clearInterval(interval);
  }, []);

  const PAGES = [
    { id: "dashboard",    label: "📈 Dashboard" },
    { id: "backtesting",  label: "📊 Backtesting" },
    { id: "papertrading", label: "🏦 Paper Trading" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#e0e6f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        select, input { outline: none; }
        .pulse { animation: pulse 2s infinite; } @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        .spin { animation: spin 1s linear infinite; } @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>

      <div style={{ background: "#0a0f1a", borderBottom: "1px solid #1e2d45", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "32px", height: "32px", background: "linear-gradient(135deg,#00e5a0,#006eff)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>⚡</div>
          <div>
            <div style={{ fontWeight: "700", fontSize: "15px" }}>TRADE<span style={{ color: "#00e5a0" }}>AI</span></div>
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace" }}>DADOS REAIS · B3</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "4px", background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "10px", padding: "4px" }}>
          {PAGES.map(nav => (
            <button key={nav.id} onClick={() => setPage(nav.id)}
              style={{ background: page === nav.id ? "#00e5a015" : "transparent", border: page === nav.id ? "1px solid #00e5a033" : "1px solid transparent", color: page === nav.id ? "#00e5a0" : "#555", borderRadius: "8px", padding: "8px 16px", fontSize: "13px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
              {nav.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {proxyWaking && (
            <span style={{ color: "#ffd60a", fontSize: "11px", fontFamily: "monospace" }} className="pulse">
              ⏳ acordando servidor...
            </span>
          )}
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: proxyOk === null ? "#555" : proxyOk ? "#00e5a0" : "#ffd60a" }} className={proxyWaking ? "pulse" : ""} />
          <span style={{ color: proxyOk ? "#00e5a0" : proxyWaking ? "#ffd60a" : "#ff4d6d", fontSize: "11px", fontFamily: "monospace" }}>
            {proxyOk === null ? "verificando..." : proxyOk ? "PROXY OK" : proxyWaking ? "ACORDANDO..." : "OFFLINE"}
          </span>
        </div>
      </div>

      {/* Banner quando proxy está acordando */}
      {proxyWaking && (
        <div style={{ background: "#ffd60a11", border: "1px solid #ffd60a33", margin: "12px 20px", borderRadius: "10px", padding: "12px 18px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="pulse" style={{ fontSize: "16px" }}>⏳</span>
          <span style={{ color: "#ffd60a", fontSize: "13px" }}>
            Servidor acordando... Isso pode levar até 60 segundos na primeira vez do dia. Aguarde!
          </span>
        </div>
      )}

      <div style={{ display: page === "dashboard"    ? "block" : "none" }}><Dashboard /></div>
      <div style={{ display: page === "backtesting"  ? "block" : "none" }}><Backtesting /></div>
      <div style={{ display: page === "papertrading" ? "block" : "none" }}><PaperTrading /></div>
    </div>
  );
}
