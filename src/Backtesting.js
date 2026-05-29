import { useState, useCallback } from "react";

const PROXY = "https://daytrade-proxy.onrender.com";

const ASSETS = [
  "PETR4", "VALE3", "ITUB4", "BBDC4", "MGLU3", "WEGE3",
  "ABEV3", "B3SA3", "RENT3", "SUZB3", "GGBR4", "EMBR3",
  "RADL3", "EQTL3", "SBSP3", "VIVT3", "LREN3", "HAPV3",
];

const PERIODS = [
  { label: "1 Mês",   range: "1mo", interval: "1d" },
  { label: "3 Meses", range: "3mo", interval: "1d" },
  { label: "6 Meses", range: "6mo", interval: "1d" },
  { label: "1 Ano",   range: "1y",  interval: "1wk" },
];

// ── Indicadores técnicos ──────────────────────────────────────────
function calcSMA(candles, period) {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.close, 0) / period;
}

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const rs = gains / (losses || 0.001);
  return 100 - 100 / (1 + rs);
}

function fmt(v) { return `R$ ${v.toFixed(2)}`; }
function pct(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

// ── Gráfico de Equity ─────────────────────────────────────────────
function EquityChart({ equity, width = 620, height = 160 }) {
  if (!equity || equity.length < 2) return null;
  const pad = { l: 55, r: 10, t: 10, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const values = equity.map(e => e.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const px = i => pad.l + (i / (equity.length - 1)) * w;
  const py = v => pad.t + h - ((v - minV) / range) * h;
  const points = equity.map((e, i) => `${px(i)},${py(e.value)}`).join(" ");
  const areaPoints = `${pad.l},${pad.t + h} ${points} ${px(equity.length - 1)},${pad.t + h}`;
  const color = values[values.length - 1] >= values[0] ? "#00e5a0" : "#ff4d6d";
  const yLabels = [minV, (minV + maxV) / 2, maxV];
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yLabels.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} y1={py(v)} x2={width - pad.r} y2={py(v)} stroke="#ffffff08" strokeDasharray="4,4" />
          <text x={pad.l - 4} y={py(v) + 4} fill="#444" fontSize="9" fontFamily="monospace" textAnchor="end">{fmt(v)}</text>
        </g>
      ))}
      <polygon points={areaPoints} fill="url(#eg)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={px(0)} cy={py(values[0])} r="3" fill={color} />
      <circle cx={px(equity.length - 1)} cy={py(values[values.length - 1])} r="4" fill={color} />
      {[0, Math.floor(equity.length / 2), equity.length - 1].map(i => (
        <text key={i} x={px(i)} y={height - 4} fill="#333" fontSize="9" fontFamily="monospace" textAnchor="middle">
          {equity[i]?.date || ""}
        </text>
      ))}
    </svg>
  );
}

// ── Gráfico de Drawdown ───────────────────────────────────────────
function DrawdownChart({ equity, width = 620, height = 90 }) {
  if (!equity || equity.length < 2) return null;
  const pad = { l: 55, r: 10, t: 8, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  let peak = equity[0].value;
  const dds = equity.map(e => {
    if (e.value > peak) peak = e.value;
    return peak > 0 ? ((e.value - peak) / peak) * 100 : 0;
  });
  const minDD = Math.min(...dds) || -0.01;
  const px = i => pad.l + (i / (equity.length - 1)) * w;
  const py = v => pad.t + (Math.abs(v) / Math.abs(minDD)) * h;
  const areaPoints = `${pad.l},${pad.t} ${dds.map((v, i) => `${px(i)},${py(v)}`).join(" ")} ${px(equity.length - 1)},${pad.t}`;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff4d6d" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ff4d6d" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <line x1={pad.l} y1={pad.t} x2={width - pad.r} y2={pad.t} stroke="#ffffff10" strokeDasharray="4,4" />
      <text x={pad.l - 4} y={pad.t + 4} fill="#444" fontSize="9" fontFamily="monospace" textAnchor="end">0%</text>
      <text x={pad.l - 4} y={pad.t + h + 4} fill="#ff4d6d" fontSize="9" fontFamily="monospace" textAnchor="end">{minDD.toFixed(1)}%</text>
      <polygon points={areaPoints} fill="url(#dg)" />
      <polyline points={dds.map((v, i) => `${px(i)},${py(v)}`).join(" ")} fill="none" stroke="#ff4d6d" strokeWidth="1.5" />
    </svg>
  );
}

// ── Tabela paginada ───────────────────────────────────────────────
function TradesTable({ trades }) {
  const [page, setPage] = useState(0);
  const perPage = 10;
  const total = Math.ceil(trades.length / perPage);
  const slice = trades.slice(page * perPage, page * perPage + perPage);
  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #1e2d45" }}>
            {["#", "Entrada", "Saída", "Tipo", "Preço Entrada", "Preço Saída", "%", "R$"].map(h => (
              <th key={h} style={{ padding: "8px 10px", color: "#444", fontFamily: "monospace", fontSize: "10px", textAlign: "left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.map((t, i) => {
            const c = t.pnl >= 0 ? "#00e5a0" : "#ff4d6d";
            return (
              <tr key={i} style={{ borderBottom: "1px solid #0d1827" }}>
                <td style={{ padding: "8px 10px", color: "#444", fontFamily: "monospace" }}>{page * perPage + i + 1}</td>
                <td style={{ padding: "8px 10px", color: "#888", fontFamily: "monospace" }}>{t.entryDate}</td>
                <td style={{ padding: "8px 10px", color: "#888", fontFamily: "monospace" }}>{t.exitDate}</td>
                <td style={{ padding: "8px 10px" }}>
                  <span style={{ background: t.type === "COMPRA" ? "#00e5a022" : "#ff4d6d22", color: t.type === "COMPRA" ? "#00e5a0" : "#ff4d6d", border: `1px solid ${t.type === "COMPRA" ? "#00e5a044" : "#ff4d6d44"}`, borderRadius: "4px", padding: "2px 7px", fontSize: "10px", fontFamily: "monospace", fontWeight: "700" }}>
                    {t.type === "COMPRA" ? "▲ COMPRA" : "▼ VENDA"}
                  </span>
                </td>
                <td style={{ padding: "8px 10px", color: "#ccc", fontFamily: "monospace" }}>{fmt(t.entryPrice)}</td>
                <td style={{ padding: "8px 10px", color: "#ccc", fontFamily: "monospace" }}>{fmt(t.exitPrice)}</td>
                <td style={{ padding: "8px 10px", color: c, fontFamily: "monospace" }}>{pct(t.pnlPct)}</td>
                <td style={{ padding: "8px 10px", color: c, fontFamily: "monospace", fontWeight: "700" }}>{fmt(t.pnl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {total > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "12px" }}>
          {Array.from({ length: total }, (_, i) => (
            <button key={i} onClick={() => setPage(i)}
              style={{ background: page === i ? "#00e5a022" : "#111a27", border: `1px solid ${page === i ? "#00e5a0" : "#1e2d45"}`, color: page === i ? "#00e5a0" : "#555", borderRadius: "6px", padding: "4px 10px", fontSize: "11px", cursor: "pointer" }}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────
export default function Backtesting() {
  const [asset, setAsset] = useState("PETR4");
  const [period, setPeriod] = useState(PERIODS[1]);
  const [stopLoss, setStopLoss] = useState("2.0");
  const [takeProfit, setTakeProfit] = useState("4.0");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [result, setResult] = useState(null);
  const [erro, setErro] = useState("");

  const runBacktest = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setErro("");
    setProgress(5);
    setProgressMsg("Buscando dados históricos da B3...");

    try {
      // 1. Buscar dados reais
      const res = await fetch(`${PROXY}/api/candles?ticker=${asset}&interval=${period.interval}&range=${period.range}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const candles = data.candles;
      if (candles.length < 10) throw new Error("Dados insuficientes. Tente outro período.");

      setProgress(25);
      setProgressMsg(`${candles.length} candles carregados. Consultando IA...`);

      // 2. IA define parâmetros da estratégia (com timeout de 20s)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      let strategy = { smaCurta: 5, smaLonga: 20, rsiCompra: 35, rsiVenda: 65, estrategia: "SMA + RSI padrão", perspectiva: "Estratégia técnica padrão aplicada." };

      try {
        const amostra = candles.slice(0, 15).map((c, i) =>
          `${i + 1}. ${c.time?.slice(0, 10)} A:${c.open.toFixed(2)} F:${c.close.toFixed(2)}`
        ).join("\n");

        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.REACT_APP_ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 300,
            messages: [{
              role: "user",
              content: `Defina parâmetros de estratégia SMA+RSI para ${asset} no período ${period.label}.
Preço inicial: R$${candles[0].close.toFixed(2)}, final: R$${candles[candles.length-1].close.toFixed(2)}.
Variação: ${(((candles[candles.length-1].close - candles[0].close)/candles[0].close)*100).toFixed(2)}%.
Amostra:\n${amostra}

Responda APENAS JSON:
{"smaCurta":5,"smaLonga":20,"rsiCompra":35,"rsiVenda":65,"estrategia":"texto","perspectiva":"texto"}`
            }],
          }),
        });
        clearTimeout(timeout);
        const aiData = await aiRes.json();
        const txt = aiData.content?.map(b => b.text || "").join("") || "";
        const clean = txt.replace(/```json|```/g, "").trim();
        strategy = JSON.parse(clean);
      } catch (aiErr) {
        clearTimeout(timeout);
        console.warn("IA timeout, usando estratégia padrão:", aiErr.message);
        setProgressMsg("IA demorou, usando estratégia padrão...");
      }

      setProgress(50);
      setProgressMsg("Simulando operações...");

      // 3. Simular operações com os parâmetros
      const { smaCurta, smaLonga, rsiCompra, rsiVenda } = strategy;
      const sl = parseFloat(stopLoss) / 100;
      const tp = parseFloat(takeProfit) / 100;
      let equity = 1000;
      const equityCurve = [{ date: candles[0].time?.slice(0, 10) || "início", value: 1000 }];
      const trades = [];
      let position = null;

      for (let i = Math.max(smaCurta, smaLonga, 14) + 1; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        const smaC = calcSMA(slice, smaCurta);
        const smaL = calcSMA(slice, smaLonga);
        const rsi = calcRSI(slice);
        const price = candles[i].close;
        const date = candles[i].time?.slice(0, 10) || `candle ${i}`;

        if (!position) {
          if (smaC > smaL && rsi < rsiVenda && rsi > 25) {
            position = { type: "COMPRA", entryPrice: price, entryDate: date };
          } else if (smaC < smaL && rsi > rsiCompra && rsi < 75) {
            position = { type: "VENDA", entryPrice: price, entryDate: date };
          }
        } else {
          let exit = false;
          if (position.type === "COMPRA") {
            const gain = (price - position.entryPrice) / position.entryPrice;
            if (gain >= tp || gain <= -sl || smaC < smaL) exit = true;
          } else {
            const gain = (position.entryPrice - price) / position.entryPrice;
            if (gain >= tp || gain <= -sl || smaC > smaL) exit = true;
          }

          if (exit) {
            const pnlPct = position.type === "COMPRA"
              ? ((price - position.entryPrice) / position.entryPrice) * 100
              : ((position.entryPrice - price) / position.entryPrice) * 100;
            const pnlVal = equity * (pnlPct / 100);
            equity += pnlVal;
            trades.push({ type: position.type, entryDate: position.entryDate, exitDate: date, entryPrice: position.entryPrice, exitPrice: price, pnlPct, pnl: pnlVal });
            equityCurve.push({ date, value: equity });
            position = null;
          }
        }

        if (i % 10 === 0) setProgress(50 + Math.floor((i / candles.length) * 40));
      }

      setProgress(95);
      setProgressMsg("Calculando estatísticas...");

      const wins = trades.filter(t => t.pnl > 0);
      const losses = trades.filter(t => t.pnl <= 0);
      const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
      const totalPnl = equity - 1000;
      const totalPnlPct = (totalPnl / 1000) * 100;
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
      const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
      const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
      const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

      let peak = 1000, maxDD = 0;
      equityCurve.forEach(e => {
        if (e.value > peak) peak = e.value;
        const dd = ((e.value - peak) / peak) * 100;
        if (dd < maxDD) maxDD = dd;
      });

      setProgress(100);
      setProgressMsg("Concluído!");
      setResult({ asset, period: period.label, finalEquity: equity, totalPnl, totalPnlPct, trades, wins: wins.length, losses: losses.length, winRate, avgWin, avgLoss, profitFactor, maxDrawdown: maxDD, equityCurve, strategy });

    } catch (e) {
      console.error(e);
      setErro(`Erro: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }, [asset, period, stopLoss, takeProfit]);

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", padding: "24px 20px" }}>
      <style>{`
        .panel { background: #0d1320; border: 1px solid #1e2d45; border-radius: 14px; padding: 20px; margin-bottom: 16px; }
        .stat  { background: #0d1320; border: 1px solid #1e2d45; border-radius: 12px; padding: 16px 18px; }
        .btn-run { background: linear-gradient(135deg,#00e5a0,#00b07a); color:#000; border:none; border-radius:10px; padding:13px 32px; font-size:14px; font-weight:700; cursor:pointer; }
        .btn-run:disabled { opacity:0.5; cursor:not-allowed; }
        .prog { height:6px; background:#1e2d45; border-radius:3px; overflow:hidden; }
        .prog-fill { height:100%; background:linear-gradient(90deg,#00e5a0,#006eff); border-radius:3px; transition:width 0.3s; }
        select,input { outline:none; }
      `}</style>

      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ marginBottom: "22px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "4px" }}>
            📊 <span style={{ color: "#00e5a0" }}>Backtesting</span> — Teste Histórico
          </h1>
          <p style={{ color: "#444", fontSize: "13px" }}>Simule a estratégia da IA em dados históricos reais da B3 · Capital inicial: R$ 1.000</p>
        </div>

        {/* Config */}
        <div className="panel">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: "14px", alignItems: "end" }}>
            {[
              { label: "ATIVO", content: (
                <select value={asset} onChange={e => setAsset(e.target.value)} disabled={running}
                  style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", fontFamily: "monospace" }}>
                  {ASSETS.map(a => <option key={a}>{a}</option>)}
                </select>
              )},
              { label: "PERÍODO", content: (
                <select value={period.label} onChange={e => setPeriod(PERIODS.find(p => p.label === e.target.value))} disabled={running}
                  style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", fontFamily: "monospace" }}>
                  {PERIODS.map(p => <option key={p.label}>{p.label}</option>)}
                </select>
              )},
              { label: "STOP LOSS %", content: (
                <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={running} step="0.5"
                  style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", fontFamily: "monospace" }} />
              )},
              { label: "TAKE PROFIT %", content: (
                <input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={running} step="0.5"
                  style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "10px 12px", fontSize: "13px", fontFamily: "monospace" }} />
              )},
            ].map(({ label, content }) => (
              <div key={label}>
                <div style={{ color: "#555", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: "6px" }}>{label}</div>
                {content}
              </div>
            ))}
            <button className="btn-run" onClick={runBacktest} disabled={running}>
              {running ? "⏳ Processando..." : "▶ Rodar Backtest"}
            </button>
          </div>

          {running && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ color: "#00e5a0", fontSize: "12px", fontFamily: "monospace" }}>{progressMsg}</span>
                <span style={{ color: "#444", fontSize: "12px", fontFamily: "monospace" }}>{progress}%</span>
              </div>
              <div className="prog"><div className="prog-fill" style={{ width: `${progress}%` }} /></div>
            </div>
          )}

          {erro && (
            <div style={{ marginTop: "12px", background: "#ff4d6d15", border: "1px solid #ff4d6d44", borderRadius: "8px", padding: "10px 14px", color: "#ff4d6d", fontSize: "13px" }}>
              {erro}
            </div>
          )}
        </div>

        {/* Resultados */}
        {result && (
          <>
            {/* Estratégia da IA */}
            <div className="panel" style={{ borderColor: "#006eff33" }}>
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>ESTRATÉGIA DEFINIDA PELA IA</div>
              <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <p style={{ color: "#bbb", fontSize: "13px", lineHeight: "1.7", marginBottom: "6px" }}>
                    <strong style={{ color: "#6af" }}>Estratégia:</strong> {result.strategy.estrategia}
                  </p>
                  <p style={{ color: "#bbb", fontSize: "13px", lineHeight: "1.7" }}>
                    <strong style={{ color: "#6af" }}>Perspectiva:</strong> {result.strategy.perspectiva}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  {[["SMA Curta", result.strategy.smaCurta], ["SMA Longa", result.strategy.smaLonga], ["RSI Compra", result.strategy.rsiCompra], ["RSI Venda", result.strategy.rsiVenda]].map(([l, v]) => (
                    <div key={l} style={{ background: "#111a27", borderRadius: "8px", padding: "10px 14px", textAlign: "center", minWidth: "72px" }}>
                      <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace" }}>{l}</div>
                      <div style={{ color: "#6af", fontSize: "20px", fontWeight: "700", fontFamily: "monospace" }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Stats principais */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "14px" }}>
              {[
                { label: "CAPITAL FINAL", value: fmt(result.finalEquity), sub: pct(result.totalPnlPct), color: result.totalPnl >= 0 ? "#00e5a0" : "#ff4d6d" },
                { label: "WIN RATE", value: `${result.winRate.toFixed(1)}%`, sub: `${result.wins}W / ${result.losses}L`, color: result.winRate >= 50 ? "#00e5a0" : "#ff4d6d" },
                { label: "PROFIT FACTOR", value: result.profitFactor.toFixed(2), sub: result.profitFactor >= 1.5 ? "✅ Bom" : result.profitFactor >= 1 ? "⚠️ Neutro" : "❌ Ruim", color: result.profitFactor >= 1.5 ? "#00e5a0" : result.profitFactor >= 1 ? "#ffd60a" : "#ff4d6d" },
                { label: "MAX DRAWDOWN", value: `${result.maxDrawdown.toFixed(1)}%`, sub: "pior queda", color: result.maxDrawdown > -10 ? "#ffd60a" : "#ff4d6d" },
              ].map((s, i) => (
                <div key={i} className="stat">
                  <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "6px" }}>{s.label}</div>
                  <div style={{ color: s.color, fontSize: "22px", fontWeight: "700" }}>{s.value}</div>
                  <div style={{ color: "#444", fontSize: "11px", marginTop: "4px" }}>{s.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px", marginBottom: "14px" }}>
              {[
                { label: "TOTAL OPERAÇÕES", value: result.trades.length, color: "#fff" },
                { label: "GANHO MÉDIO", value: pct(result.avgWin), color: "#00e5a0" },
                { label: "PERDA MÉDIA", value: pct(result.avgLoss), color: "#ff4d6d" },
                { label: "P&L TOTAL", value: fmt(result.totalPnl), color: result.totalPnl >= 0 ? "#00e5a0" : "#ff4d6d" },
              ].map((s, i) => (
                <div key={i} className="stat">
                  <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "6px" }}>{s.label}</div>
                  <div style={{ color: s.color, fontSize: "20px", fontWeight: "700" }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Gráficos */}
            <div className="panel">
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>CURVA DE EQUITY</div>
              <EquityChart equity={result.equityCurve} width={1060} height={160} />
            </div>

            <div className="panel">
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>
                DRAWDOWN MÁXIMO: {result.maxDrawdown.toFixed(2)}%
              </div>
              <DrawdownChart equity={result.equityCurve} width={1060} height={90} />
            </div>

            {/* Tabela */}
            <div className="panel">
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "14px" }}>
                OPERAÇÕES SIMULADAS — {result.trades.length} no total
              </div>
              {result.trades.length === 0 ? (
                <div style={{ color: "#333", textAlign: "center", padding: "30px", fontSize: "13px" }}>
                  Nenhuma operação gerada. Tente reduzir o Stop Loss ou Take Profit.
                </div>
              ) : (
                <TradesTable trades={result.trades} />
              )}
            </div>

            <div style={{ padding: "12px 18px", background: "#0d1320", border: "1px solid #ffd60a22", borderRadius: "10px" }}>
              <span style={{ color: "#666", fontSize: "12px" }}>
                <strong style={{ color: "#ffd60a" }}>⚠️ Importante:</strong> Resultados passados não garantem resultados futuros. Simulação sem slippage, corretagem ou liquidez real.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
