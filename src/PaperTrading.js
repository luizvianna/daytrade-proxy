import { useState, useEffect, useRef, useCallback } from "react";

const PROXY = "https://daytrade-proxy.onrender.com";
const CAPITAL_INICIAL = 1000;
const GROQ_API_KEY = process.env.REACT_APP_GROQ_KEY || "";
const AI_INTERVAL = 120;

// ── EmailJS Config ────────────────────────────────────────────────
const EMAILJS_SERVICE_ID = "service_ihson4a";
const EMAILJS_TEMPLATE_ID = "kjk77se";
const EMAILJS_PUBLIC_KEY = "bo4buMO  hihibhLErD"; // substitua pela nova chave

const ASSETS = [
  "PETR4", "VALE3", "ITUB4", "BBDC4", "MGLU3", "WEGE3",
  "ABEV3", "B3SA3", "RENT3", "SUZB3", "GGBR4", "EMBR3",
];

// ── Enviar email via EmailJS ──────────────────────────────────────
const sendEmailNotification = async ({ tipo_sinal, ativo, preco, stop_loss, take_profit, confianca, analise }) => {
  try {
    const horario = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          tipo_sinal,
          ativo,
          preco,
          stop_loss,
          take_profit,
          confianca,
          analise,
          horario,
        },
      }),
    });
    if (response.ok) {
      console.log("✅ Email enviado com sucesso!");
      return true;
    } else {
      console.error("Erro ao enviar email:", response.status);
      return false;
    }
  } catch (e) {
    console.error("Erro EmailJS:", e.message);
    return false;
  }
};

function calcSMA(candles, period) {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  return candles.slice(-period).reduce((s, c) => s + c.close, 0) / period;
}

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  return 100 - 100 / (1 + gains / (losses || 0.001));
}

function calcMACD(candles) {
  if (candles.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calcSMA(candles, 12);
  const ema26 = calcSMA(candles, 26);
  const macd = ema12 - ema26;
  const signal = calcSMA(candles.slice(-9), 9);
  return { macd, signal, histogram: macd - signal };
}

function calcVolume(candles) {
  if (candles.length < 2) return { current: 0, avg: 0, ratio: 1 };
  const avg = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  const current = candles[candles.length - 1]?.volume || 0;
  return { current, avg, ratio: avg > 0 ? current / avg : 1 };
}

function calcBB(candles, period = 20) {
  if (candles.length < period) return { upper: 0, lower: 0, middle: 0, width: 0 };
  const slice = candles.slice(-period);
  const middle = slice.reduce((s, c) => s + c.close, 0) / period;
  const variance = slice.reduce((s, c) => s + Math.pow(c.close - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + 2 * std, lower: middle - 2 * std, middle, width: (4 * std / middle) * 100 };
}

function fmt(v) { return `R$ ${v.toFixed(2)}`; }
function pct(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

function CandleChart({ candles, width = 640, height = 150 }) {
  if (!candles || candles.length === 0) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "#2a2a2a", fontSize: "13px" }}>Carregando candles...</div>
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
  const sma5 = last.map((_, i) => { const sl = last.slice(Math.max(0, i - 4), i + 1); return sl.reduce((s, c) => s + c.close, 0) / sl.length; });
  const sma20 = last.map((_, i) => { const sl = last.slice(Math.max(0, i - 19), i + 1); return sl.reduce((s, c) => s + c.close, 0) / sl.length; });
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <polyline points={sma5.map((v, i) => `${pad.l + i * cw + cw/2},${py(v)}`).join(" ")} fill="none" stroke="#6af" strokeWidth="1" opacity="0.6" />
      <polyline points={sma20.map((v, i) => `${pad.l + i * cw + cw/2},${py(v)}`).join(" ")} fill="none" stroke="#ffd60a" strokeWidth="1" opacity="0.6" />
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
      <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke="#ffffff10" />
      <rect x={pad.l} y={pad.t} width="38" height="11" fill="#0d1320" opacity="0.8" rx="2" />
      <text x={pad.l + 3} y={pad.t + 8} fill="#6af" fontSize="7" fontFamily="monospace">SMA5</text>
      <rect x={pad.l + 42} y={pad.t} width="44" height="11" fill="#0d1320" opacity="0.8" rx="2" />
      <text x={pad.l + 45} y={pad.t + 8} fill="#ffd60a" fontSize="7" fontFamily="monospace">SMA20</text>
    </svg>
  );
}

function MiniEquity({ data, width = 260, height = 55 }) {
  if (!data || data.length < 2) return null;
  const pad = 4;
  const w = width - pad * 2; const h = height - pad * 2;
  const values = data.map(d => d.value);
  const minV = Math.min(...values); const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const px = i => pad + (i / (data.length - 1)) * w;
  const py = v => pad + h - ((v - minV) / range) * h;
  const points = data.map((d, i) => `${px(i)},${py(d.value)}`).join(" ");
  const area = `${pad},${pad + h} ${points} ${px(data.length - 1)},${pad + h}`;
  const color = values[values.length - 1] >= values[0] ? "#00e5a0" : "#ff4d6d";
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <defs><linearGradient id="meg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <polygon points={area} fill="url(#meg)" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function PositionCard({ position, currentPrice, onClose }) {
  if (!position || !currentPrice) return null;
  const pnlPct = position.type === "COMPRA" ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100 : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
  const pnlVal = position.size * (pnlPct / 100);
  const color = pnlVal >= 0 ? "#00e5a0" : "#ff4d6d";
  const elapsed = Math.floor((Date.now() - position.openedAt) / 60000);
  return (
    <div style={{ background: "#0d1320", border: `2px solid ${color}44`, borderRadius: "14px", padding: "16px", marginBottom: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#fff", fontWeight: "700", fontSize: "16px" }}>{position.asset}</span>
          <span style={{ background: position.type === "COMPRA" ? "#00e5a022" : "#ff4d6d22", color: position.type === "COMPRA" ? "#00e5a0" : "#ff4d6d", border: `1px solid ${position.type === "COMPRA" ? "#00e5a044" : "#ff4d6d44"}`, borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontFamily: "monospace", fontWeight: "700" }}>
            {position.type === "COMPRA" ? "▲ COMPRA" : "▼ VENDA"}
          </span>
          <span style={{ color: "#444", fontSize: "11px" }}>{elapsed}min aberta</span>
        </div>
        <button onClick={onClose} style={{ background: "#ff4d6d22", border: "1px solid #ff4d6d55", color: "#ff4d6d", borderRadius: "8px", padding: "5px 12px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>✕ Fechar</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "10px" }}>
        {[{ label: "Entrada", value: fmt(position.entryPrice), c: "#aaa" }, { label: "Atual", value: fmt(currentPrice), c: "#fff" }, { label: "Stop Loss", value: fmt(position.sl), c: "#ff4d6d" }, { label: "Take Profit", value: fmt(position.tp), c: "#00e5a0" }].map(({ label, value, c }) => (
          <div key={label} style={{ background: "#111a27", borderRadius: "8px", padding: "8px 10px" }}>
            <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.1em" }}>{label}</div>
            <div style={{ color: c, fontSize: "13px", fontWeight: "700", fontFamily: "monospace", marginTop: "2px" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#111a27", borderRadius: "10px", padding: "12px 14px", display: "flex", justifyContent: "space-between" }}>
        <div><div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace" }}>P&L ATUAL</div><div style={{ color, fontSize: "22px", fontWeight: "700", fontFamily: "monospace" }}>{fmt(pnlVal)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace" }}>VARIAÇÃO</div><div style={{ color, fontSize: "22px", fontWeight: "700", fontFamily: "monospace" }}>{pct(pnlPct)}</div></div>
      </div>
    </div>
  );
}

function TradeHistory({ trades }) {
  if (!trades.length) return <div style={{ color: "#2a2a2a", textAlign: "center", padding: "20px", fontSize: "13px" }}>Nenhuma operação fechada ainda</div>;
  return (
    <div style={{ maxHeight: "180px", overflowY: "auto" }}>
      {trades.map((t, i) => {
        const c = t.pnl >= 0 ? "#00e5a0" : "#ff4d6d";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 0", borderBottom: "1px solid #0d1827", flexWrap: "wrap" }}>
            <span style={{ color: "#333", fontSize: "10px", fontFamily: "monospace" }}>{t.time}</span>
            <span style={{ background: t.type === "COMPRA" ? "#00e5a022" : "#ff4d6d22", color: t.type === "COMPRA" ? "#00e5a0" : "#ff4d6d", border: `1px solid ${t.type === "COMPRA" ? "#00e5a044" : "#ff4d6d44"}`, borderRadius: "4px", padding: "1px 7px", fontSize: "10px", fontFamily: "monospace", fontWeight: "700" }}>
              {t.type === "COMPRA" ? "▲" : "▼"} {t.type}
            </span>
            <span style={{ color: "#888", fontFamily: "monospace", fontSize: "12px", fontWeight: "700" }}>{t.asset}</span>
            <span style={{ color: "#444", fontSize: "11px", fontFamily: "monospace" }}>{fmt(t.entryPrice)} → {fmt(t.exitPrice)}</span>
            <span style={{ color: c, fontFamily: "monospace", fontSize: "12px", fontWeight: "700", marginLeft: "auto" }}>{pct(t.pnlPct)} · {fmt(t.pnl)}</span>
            <span style={{ color: "#333", fontSize: "10px" }}>({t.reason})</span>
          </div>
        );
      })}
    </div>
  );
}

function SignalAlert({ alert, onDismiss }) {
  useEffect(() => { const t = setTimeout(onDismiss, 8000); return () => clearTimeout(t); }, [onDismiss]);
  const color = alert.signal === "COMPRA" ? "#00e5a0" : alert.signal === "VENDA" ? "#ff4d6d" : "#ffd60a";
  return (
    <div style={{ position: "fixed", top: "70px", right: "20px", zIndex: 9999, background: "#0d1320", border: `1px solid ${color}`, borderRadius: "12px", padding: "14px 18px", maxWidth: "300px", boxShadow: `0 8px 30px ${color}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ color, fontWeight: "700", fontSize: "12px", fontFamily: "monospace" }}>{alert.title}</span>
        <button onClick={onDismiss} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "16px" }}>×</button>
      </div>
      <p style={{ color: "#888", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>{alert.message}</p>
    </div>
  );
}

function AnalysisPanel({ analysis, indicators, countdown, analysisHistory }) {
  if (!indicators && !analysis) return null;
  const signalColor = !analysis ? "#555" : analysis.action === "COMPRAR" ? "#00e5a0" : analysis.action === "VENDER" ? "#ff4d6d" : "#ffd60a";

  const getRSIInfo = (rsi) => {
    if (rsi >= 70) return { label: "SOBRECOMPRADO", color: "#ff4d6d", desc: `RSI em ${rsi.toFixed(0)} — ativo comprado demais. Risco de queda iminente.` };
    if (rsi <= 30) return { label: "SOBREVENDIDO", color: "#00e5a0", desc: `RSI em ${rsi.toFixed(0)} — ativo vendido demais. Possível oportunidade de compra.` };
    if (rsi >= 60) return { label: "FORÇA COMPRADORA", color: "#ffd60a", desc: `RSI em ${rsi.toFixed(0)} — pressão compradora, mas ainda há espaço antes de sobrecompra.` };
    if (rsi <= 40) return { label: "FORÇA VENDEDORA", color: "#ffd60a", desc: `RSI em ${rsi.toFixed(0)} — pressão vendedora moderada.` };
    return { label: "NEUTRO", color: "#888", desc: `RSI em ${rsi.toFixed(0)} — neutro, sem pressão clara.` };
  };

  const getSMAInfo = (sma5, sma20) => {
    const diff = ((sma5 - sma20) / sma20 * 100).toFixed(2);
    if (sma5 > sma20 * 1.002) return { label: "CRUZAMENTO ALTA ▲", color: "#00e5a0", desc: `SMA5 (${sma5.toFixed(2)}) está ${diff}% acima da SMA20. Tendência de alta confirmada.` };
    if (sma5 < sma20 * 0.998) return { label: "CRUZAMENTO BAIXA ▼", color: "#ff4d6d", desc: `SMA5 (${sma5.toFixed(2)}) está abaixo da SMA20. Tendência de queda confirmada.` };
    return { label: "CONVERGINDO →", color: "#ffd60a", desc: `SMA5 e SMA20 muito próximas. Mercado indeciso, aguardando direção.` };
  };

  const getMACDInfo = (macd, signal) => {
    if (macd > signal && macd > 0) return { label: "BULLISH FORTE ▲", color: "#00e5a0", desc: `MACD acima do sinal e positivo. Momentum de alta forte, favorece compra.` };
    if (macd > signal && macd <= 0) return { label: "RECUPERANDO ↗", color: "#ffd60a", desc: `MACD cruzou acima do sinal mas ainda negativo. Possível reversão de alta.` };
    if (macd < signal && macd < 0) return { label: "BEARISH FORTE ▼", color: "#ff4d6d", desc: `MACD abaixo do sinal e negativo. Momentum de baixa, favorece venda.` };
    return { label: "ENFRAQUECENDO ↘", color: "#ffd60a", desc: `Força compradora diminuindo. Cuidado com possível reversão.` };
  };

  const getVolInfo = (ratio) => {
    if (ratio >= 2) return { label: "VOLUME ALTO ▲▲", color: "#00e5a0", desc: `Volume ${ratio.toFixed(1)}x acima da média. Movimento forte e confiável.` };
    if (ratio >= 1.3) return { label: "ACIMA DA MÉDIA ▲", color: "#ffd60a", desc: `Volume ${ratio.toFixed(1)}x acima da média. Boa participação do mercado.` };
    if (ratio <= 0.3) return { label: "VOLUME MUITO BAIXO ▼▼", color: "#ff4d6d", desc: `Volume quase zero. Evite operar — movimentos sem volume são armadilhas.` };
    if (ratio <= 0.7) return { label: "VOLUME BAIXO ▼", color: "#ff4d6d", desc: `Volume ${ratio.toFixed(1)}x abaixo da média. Sinais menos confiáveis.` };
    return { label: "VOLUME NORMAL →", color: "#888", desc: `Volume dentro da normalidade. Condições adequadas para operar.` };
  };

  const getBBInfo = (price, bb) => {
    if (!bb || !bb.upper) return { label: "SEM DADOS", color: "#555", desc: "Dados insuficientes." };
    if (price >= bb.upper) return { label: "ACIMA DA BANDA ▲", color: "#ff4d6d", desc: `Preço tocou a banda superior (${fmt(bb.upper)}). Alta probabilidade de correção.` };
    if (price <= bb.lower) return { label: "ABAIXO DA BANDA ▼", color: "#00e5a0", desc: `Preço tocou a banda inferior (${fmt(bb.lower)}). Possível recuperação.` };
    const pos = ((price - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0);
    return { label: `DENTRO DAS BANDAS (${pos}%)`, color: "#888", desc: `Preço está ${pos}% dentro das bandas. Mercado em equilíbrio.` };
  };

  const getTrendInfo = (trend, bullCandles) => {
    if (trend === "ALTA") return { label: "TENDÊNCIA ALTA ▲", color: "#00e5a0", desc: `${bullCandles}/20 candles de alta. Tendência favorável para compra.` };
    if (trend === "BAIXA") return { label: "TENDÊNCIA BAIXA ▼", color: "#ff4d6d", desc: `Apenas ${bullCandles}/20 candles de alta. Tendência de queda.` };
    return { label: "LATERAL →", color: "#ffd60a", desc: `${bullCandles}/20 candles de alta. Mercado sem direção definida.` };
  };

  const rsiInfo = indicators ? getRSIInfo(indicators.rsi) : null;
  const smaInfo = indicators ? getSMAInfo(indicators.sma5, indicators.sma20) : null;
  const macdInfo = indicators ? getMACDInfo(indicators.macd.macd, indicators.macd.signal) : null;
  const volInfo = indicators ? getVolInfo(indicators.volume.ratio) : null;
  const bbInfo = indicators ? getBBInfo(analysis?.price || 0, indicators.bb) : null;
  const trendInfo = indicators ? getTrendInfo(indicators.trend, indicators.bullCandles) : null;

  return (
    <div style={{ background: "#0a0f1a", border: "1px solid #1e2d45", borderRadius: "14px", padding: "22px", marginTop: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "16px" }}>📊</span>
          <span style={{ fontWeight: "700", fontSize: "14px" }}>PAINEL DE ANÁLISE DETALHADA</span>
          {analysis && (
            <span style={{ background: `${signalColor}11`, border: `1px solid ${signalColor}44`, color: signalColor, borderRadius: "6px", padding: "3px 10px", fontSize: "12px", fontWeight: "700", fontFamily: "monospace" }}>
              {analysis.action} · {analysis.confidence}% conf.
            </span>
          )}
        </div>
        {countdown > 0 && (
          <div style={{ color: "#444", fontSize: "12px", fontFamily: "monospace" }}>
            ⏱ Próxima análise em <strong style={{ color: countdown <= 10 ? "#ffd60a" : "#555" }}>{countdown}s</strong>
          </div>
        )}
      </div>

      {indicators && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px", marginBottom: "20px" }}>
          {[
            { title: "RSI (14)", value: indicators.rsi.toFixed(1), info: rsiInfo, extra: <div style={{ height: "4px", background: "#1e2d45", borderRadius: "2px", marginTop: "6px" }}><div style={{ height: "100%", width: `${indicators.rsi}%`, background: rsiInfo.color, borderRadius: "2px" }} /></div> },
            { title: "MÉDIAS SMA 5/20", value: smaInfo.label, info: smaInfo, extra: <div style={{ color: "#555", fontSize: "10px", fontFamily: "monospace", marginTop: "4px" }}>SMA5: {indicators.sma5.toFixed(2)} · SMA20: {indicators.sma20.toFixed(2)}</div> },
            { title: "MACD", value: macdInfo.label, info: macdInfo, extra: <div style={{ color: "#555", fontSize: "10px", fontFamily: "monospace", marginTop: "4px" }}>MACD: {indicators.macd.macd.toFixed(3)} · Sinal: {indicators.macd.signal.toFixed(3)}</div> },
            { title: "VOLUME", value: volInfo.label, info: volInfo, extra: <div style={{ color: "#555", fontSize: "10px", fontFamily: "monospace", marginTop: "4px" }}>{indicators.volume.ratio.toFixed(2)}x vs média</div> },
            { title: "BOLLINGER BANDS", value: bbInfo.label, info: bbInfo, extra: <div style={{ color: "#555", fontSize: "10px", fontFamily: "monospace", marginTop: "4px" }}>↑{indicators.bb.upper.toFixed(2)} — {indicators.bb.middle.toFixed(2)} — ↓{indicators.bb.lower.toFixed(2)}</div> },
            { title: "TENDÊNCIA", value: trendInfo.label, info: trendInfo, extra: <div style={{ color: "#555", fontSize: "10px", fontFamily: "monospace", marginTop: "4px" }}>{indicators.bullCandles}/20 candles de alta</div> },
          ].map(({ title, value, info, extra }) => (
            <div key={title} style={{ background: "#0d1320", border: `1px solid ${info.color}22`, borderRadius: "10px", padding: "14px" }}>
              <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "6px" }}>{title}</div>
              <div style={{ color: info.color, fontSize: "13px", fontWeight: "700", marginBottom: "4px" }}>{value}</div>
              {extra}
              <div style={{ color: "#666", fontSize: "11px", lineHeight: "1.5", marginTop: "8px", borderTop: "1px solid #1e2d45", paddingTop: "8px" }}>{info.desc}</div>
            </div>
          ))}
        </div>
      )}

      {analysis && (
        <div style={{ background: "#0d1320", border: `1px solid ${signalColor}33`, borderRadius: "12px", padding: "18px", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "6px" }}>💬 O QUE A IA ESTÁ PENSANDO · {analysis.time}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ color: signalColor, fontSize: "18px", fontWeight: "700", fontFamily: "monospace" }}>
                  {analysis.action === "COMPRAR" ? "▲ COMPRAR" : analysis.action === "VENDER" ? "▼ VENDER" : analysis.action === "FECHAR" ? "✕ FECHAR" : analysis.action === "MANTER" ? "● MANTER" : "◆ AGUARDAR"}
                </span>
                <span style={{ background: "#111a27", color: analysis.confidence >= 70 ? "#00e5a0" : analysis.confidence >= 50 ? "#ffd60a" : "#ff4d6d", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontFamily: "monospace" }}>{analysis.confidence}% confiança</span>
                <span style={{ background: "#111a27", color: analysis.risk === "BAIXO" ? "#00e5a0" : analysis.risk === "MÉDIO" ? "#ffd60a" : "#ff4d6d", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontFamily: "monospace" }}>Risco {analysis.risk || "MÉDIO"}</span>
              </div>
            </div>
            <div style={{ minWidth: "140px" }}>
              <div style={{ color: "#444", fontSize: "9px", fontFamily: "monospace", marginBottom: "4px" }}>NÍVEL DE CONFIANÇA</div>
              <div style={{ height: "8px", background: "#1e2d45", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${analysis.confidence}%`, background: analysis.confidence >= 70 ? "#00e5a0" : analysis.confidence >= 50 ? "#ffd60a" : "#ff4d6d", borderRadius: "4px", transition: "width 0.5s" }} />
              </div>
              <div style={{ color: signalColor, fontSize: "11px", fontFamily: "monospace", fontWeight: "700", marginTop: "2px" }}>{analysis.confidence}%</div>
            </div>
          </div>

          <div style={{ marginBottom: "14px" }}>
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "8px" }}>📝 RACIOCÍNIO COMPLETO DA IA</div>
            <div style={{ background: "#111a27", borderRadius: "10px", padding: "14px 16px", borderLeft: `4px solid ${signalColor}` }}>
              <p style={{ color: "#ddd", fontSize: "13px", lineHeight: "1.9", margin: 0 }}>{analysis.fullReasoning || analysis.reasoning}</p>
            </div>
          </div>

          {analysis.indicatorNarrative && analysis.indicatorNarrative.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "8px" }}>🔍 ANÁLISE INDICADOR POR INDICADOR</div>
              <div style={{ background: "#111a27", borderRadius: "10px", padding: "14px 16px" }}>
                {analysis.indicatorNarrative.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", marginBottom: i < analysis.indicatorNarrative.length - 1 ? "10px" : 0, paddingBottom: i < analysis.indicatorNarrative.length - 1 ? "10px" : 0, borderBottom: i < analysis.indicatorNarrative.length - 1 ? "1px solid #1e2d45" : "none" }}>
                    <span style={{ fontSize: "14px", minWidth: "20px" }}>{item.bullish ? "✅" : item.bearish ? "❌" : "⚠️"}</span>
                    <div>
                      <span style={{ color: item.bullish ? "#00e5a0" : item.bearish ? "#ff4d6d" : "#ffd60a", fontSize: "11px", fontFamily: "monospace", fontWeight: "700" }}>{item.indicator}: </span>
                      <span style={{ color: "#bbb", fontSize: "12px", lineHeight: "1.6" }}>{item.observation}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(analysis.pros?.length > 0 || analysis.cons?.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div style={{ background: "#00e5a008", border: "1px solid #00e5a022", borderRadius: "8px", padding: "12px" }}>
                <div style={{ color: "#00e5a0", fontSize: "10px", fontFamily: "monospace", marginBottom: "8px", fontWeight: "700" }}>✅ POR QUE ESTA DECISÃO</div>
                {(analysis.pros || []).map((p, i) => <div key={i} style={{ color: "#aaa", fontSize: "12px", lineHeight: "1.7", display: "flex", gap: "6px" }}><span style={{ color: "#00e5a0" }}>•</span> {p}</div>)}
              </div>
              <div style={{ background: "#ff4d6d08", border: "1px solid #ff4d6d22", borderRadius: "8px", padding: "12px" }}>
                <div style={{ color: "#ff4d6d", fontSize: "10px", fontFamily: "monospace", marginBottom: "8px", fontWeight: "700" }}>⚠️ RISCOS E PONTOS CONTRA</div>
                {(analysis.cons || []).map((c, i) => <div key={i} style={{ color: "#aaa", fontSize: "12px", lineHeight: "1.7", display: "flex", gap: "6px" }}><span style={{ color: "#ff4d6d" }}>•</span> {c}</div>)}
              </div>
            </div>
          )}
        </div>
      )}

      {analysisHistory && analysisHistory.length > 1 && (
        <div>
          <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>🕐 HISTÓRICO DE SINAIS ANTERIORES</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {analysisHistory.slice(1, 8).map((h, i) => {
              const c = h.action === "COMPRAR" ? "#00e5a0" : h.action === "VENDER" ? "#ff4d6d" : "#ffd60a";
              return (
                <div key={i} style={{ background: "#0d1320", border: `1px solid ${c}33`, borderRadius: "8px", padding: "8px 12px", minWidth: "120px", maxWidth: "180px" }}>
                  <div style={{ color: "#333", fontSize: "9px", fontFamily: "monospace" }}>{h.time}</div>
                  <div style={{ color: c, fontSize: "12px", fontWeight: "700", fontFamily: "monospace", marginTop: "2px" }}>{h.action}</div>
                  <div style={{ color: "#444", fontSize: "10px" }}>{h.confidence}% · R${h.price?.toFixed(2)}</div>
                  <div style={{ color: "#555", fontSize: "10px", marginTop: "4px", lineHeight: "1.4" }}>{h.reasoning?.slice(0, 50)}...</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PaperTrading() {
  const [asset, setAsset] = useState("PETR4");
  const [stopLoss, setStopLoss] = useState("2.0");
  const [takeProfit, setTakeProfit] = useState("4.0");
  const [running, setRunning] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [capital, setCapital] = useState(CAPITAL_INICIAL);
  const [position, setPosition] = useState(null);
  const [trades, setTrades] = useState([]);
  const [equityCurve, setEquityCurve] = useState([{ date: "início", value: CAPITAL_INICIAL }]);
  const [candles, setCandles] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [allPrices, setAllPrices] = useState({});
  const [loadingData, setLoadingData] = useState(false);
  const [loadingAI, setLoadingAI] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState(null);
  const [analysisHistory, setAnalysisHistory] = useState([]);
  const [indicators, setIndicators] = useState(null);
  const [alert, setAlert] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [status, setStatus] = useState("Aguardando...");
  const [countdown, setCountdown] = useState(0);
  const [emailStatus, setEmailStatus] = useState("");

  const positionRef = useRef(null);
  const capitalRef = useRef(CAPITAL_INICIAL);
  const priceRef = useRef(null);
  const candlesRef = useRef([]);
  const countdownRef = useRef(null);
  const emailEnabledRef = useRef(true);
  positionRef.current = position;
  capitalRef.current = capital;
  priceRef.current = currentPrice;
  candlesRef.current = candles;
  emailEnabledRef.current = emailEnabled;

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
  const totalPnl = capital - CAPITAL_INICIAL;
  const totalPnlPct = (totalPnl / CAPITAL_INICIAL) * 100;
  const dailyPnl = trades.reduce((s, t) => s + t.pnl, 0);

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(AI_INTERVAL);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => { if (prev <= 1) { clearInterval(countdownRef.current); return 0; } return prev - 1; });
    }, 1000);
  }, []);

  const fetchCandles = useCallback(async (assetName) => {
    setLoadingData(true);
    setStatus("Buscando dados...");
    try {
      const res = await fetch(`${PROXY}/api/candles?ticker=${assetName}&interval=5m&range=5d`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCandles(data.candles);
      setCurrentPrice(data.currentPrice);
      priceRef.current = data.currentPrice;
      candlesRef.current = data.candles;
      setLastUpdate(new Date().toLocaleTimeString("pt-BR"));
      setStatus("Dados carregados ✓");
      if (data.candles.length > 20) {
        const cands = data.candles;
        const rsi = calcRSI(cands);
        const sma5 = calcSMA(cands, 5);
        const sma20 = calcSMA(cands, 20);
        const macd = calcMACD(cands);
        const volume = calcVolume(cands);
        const bb = calcBB(cands);
        const last20 = cands.slice(-20);
        const bullCandles = last20.filter(c => c.close > c.open).length;
        const trend = bullCandles >= 12 ? "ALTA" : bullCandles <= 8 ? "BAIXA" : "LATERAL";
        setIndicators({ rsi, sma5, sma20, macd, volume, bb, trend, bullCandles });
      }
      return data;
    } catch (e) { console.error("Erro candles:", e.message); setStatus("Erro ao buscar dados"); return null; }
    finally { setLoadingData(false); }
  }, []);

  const fetchAllPrices = useCallback(async () => {
    try { const res = await fetch(`${PROXY}/api/prices?tickers=${ASSETS.join(",")}`); setAllPrices(await res.json()); }
    catch (e) { console.error(e); }
  }, []);

  const closePosition = useCallback(async (reason, exitPrice) => {
    const pos = positionRef.current;
    const price = exitPrice || priceRef.current;
    const cap = capitalRef.current;
    if (!pos || !price) return;
    const pnlPct = pos.type === "COMPRA" ? ((price - pos.entryPrice) / pos.entryPrice) * 100 : ((pos.entryPrice - price) / pos.entryPrice) * 100;
    const pnlVal = pos.size * (pnlPct / 100);
    const newCapital = cap + pnlVal;
    setTrades(prev => [{ asset: pos.asset, type: pos.type, entryPrice: pos.entryPrice, exitPrice: price, pnlPct, pnl: pnlVal, size: pos.size, time: new Date().toLocaleTimeString("pt-BR"), reason }, ...prev]);
    setCapital(newCapital); capitalRef.current = newCapital;
    setEquityCurve(prev => [...prev, { date: new Date().toLocaleTimeString("pt-BR"), value: newCapital }]);
    setPosition(null); positionRef.current = null;

    const alertMsg = { signal: pnlVal >= 0 ? "LUCRO" : "PERDA", title: pnlVal >= 0 ? "✅ FECHADO COM LUCRO" : "❌ FECHADO COM PERDA", message: `${pos.asset} — ${reason}: ${pnlVal >= 0 ? "+" : ""}${fmt(pnlVal)} (${pct(pnlPct)})` };
    setAlert(alertMsg);

    // Email ao fechar posição
    if (emailEnabledRef.current) {
      const sent = await sendEmailNotification({
        tipo_sinal: pnlVal >= 0 ? `✅ POSIÇÃO FECHADA COM LUCRO (${reason})` : `❌ POSIÇÃO FECHADA COM PERDA (${reason})`,
        ativo: pos.asset,
        preco: fmt(price),
        stop_loss: fmt(pos.sl),
        take_profit: fmt(pos.tp),
        confianca: "—",
        analise: `Posição de ${pos.type} encerrada por ${reason}. Resultado: ${pnlVal >= 0 ? "+" : ""}${fmt(pnlVal)} (${pct(pnlPct)})`,
      });
      setEmailStatus(sent ? "📧 Email enviado!" : "⚠️ Erro no email");
      setTimeout(() => setEmailStatus(""), 5000);
    }
  }, []);

  const analyzeAndTrade = useCallback(async () => {
    const cands = candlesRef.current;
    const price = priceRef.current;
    const pos = positionRef.current;
    const cap = capitalRef.current;
    if (!cands || cands.length < 5 || !price) { setStatus("Aguardando dados..."); return; }

    if (pos) {
      const pnlPct = pos.type === "COMPRA" ? ((price - pos.entryPrice) / pos.entryPrice) * 100 : ((pos.entryPrice - price) / pos.entryPrice) * 100;
      if (pnlPct <= -parseFloat(stopLoss)) { closePosition("Stop Loss", price); return; }
      if (pnlPct >= parseFloat(takeProfit)) { closePosition("Take Profit", price); return; }
    }

    setLoadingAI(true);
    setStatus("IA analisando...");

    try {
      const last20 = cands.slice(-20);
      const sma5 = calcSMA(cands, 5);
      const sma20 = calcSMA(cands, 20);
      const rsi = calcRSI(cands);
      const macd = calcMACD(cands);
      const volume = calcVolume(cands);
      const bb = calcBB(cands);
      const bullCandles = last20.filter(c => c.close > c.open).length;
      const trend = bullCandles >= 12 ? "ALTA" : bullCandles <= 8 ? "BAIXA" : "LATERAL";
      const lastC = cands[cands.length - 1];
      const priceVsBB = price > bb.upper ? "ACIMA da banda superior" : price < bb.lower ? "ABAIXO da banda inferior" : "DENTRO das bandas";

      const prompt = `Você é um trader quantitativo especialista na B3 brasileira fazendo paper trading.

MERCADO:
Ativo: ${asset} | Preço: R$${price.toFixed(2)} | Timeframe: 5min
RSI(14): ${rsi.toFixed(1)} | SMA5: ${sma5.toFixed(2)} | SMA20: ${sma20.toFixed(2)}
MACD: ${macd.macd.toFixed(3)} | Sinal: ${macd.signal.toFixed(3)}
Volume: ${volume.ratio.toFixed(2)}x | Bollinger: ${priceVsBB}
Tendência: ${trend} (${bullCandles}/20) | Último candle: A${lastC.open.toFixed(2)} F${lastC.close.toFixed(2)}

CARTEIRA:
Capital: R$${cap.toFixed(2)} | Posição: ${pos ? `${pos.type} desde R$${pos.entryPrice.toFixed(2)}` : "Nenhuma"}
SL: ${stopLoss}% | TP: ${takeProfit}%

${!pos ? "Sem posição. Decida: COMPRAR, VENDER ou AGUARDAR" : "Com posição. Decida: MANTER ou FECHAR"}
Só opere com confiança ≥ 65%.

Responda APENAS JSON:
{
  "action": "${!pos ? "COMPRAR|VENDER|AGUARDAR" : "MANTER|FECHAR"}",
  "confidence": 0-100,
  "risk": "BAIXO|MÉDIO|ALTO",
  "reasoning": "resumo em 1 frase",
  "fullReasoning": "análise narrativa completa em 4-5 frases",
  "indicatorNarrative": [
    {"indicator":"RSI","observation":"explicação","bullish":true,"bearish":false},
    {"indicator":"SMA","observation":"explicação","bullish":true,"bearish":false},
    {"indicator":"MACD","observation":"explicação","bullish":false,"bearish":true},
    {"indicator":"Volume","observation":"explicação","bullish":false,"bearish":false},
    {"indicator":"Bollinger","observation":"explicação","bullish":false,"bearish":false}
  ],
  "pros": ["motivo 1","motivo 2","motivo 3"],
  "cons": ["risco 1","risco 2"],
  "size": ${!pos ? "valor R$ a investir" : 0}
}`;

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 800, temperature: 0.2,
          messages: [
            { role: "system", content: "Trader quantitativo especialista. Responda APENAS JSON válido, sem texto extra." },
            { role: "user", content: prompt }
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Erro Groq");
      const text = data.choices?.[0]?.message?.content || "";
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

      const analysisResult = {
        time: new Date().toLocaleTimeString("pt-BR"),
        action: parsed.action, confidence: parsed.confidence,
        risk: parsed.risk, reasoning: parsed.reasoning,
        fullReasoning: parsed.fullReasoning,
        indicatorNarrative: parsed.indicatorNarrative || [],
        pros: parsed.pros || [], cons: parsed.cons || [], price,
      };

      setLastAnalysis(analysisResult);
      setAnalysisHistory(prev => [analysisResult, ...prev].slice(0, 10));
      setStatus(`IA: ${parsed.action} (${parsed.confidence}% conf.)`);
      startCountdown();

      const sl = parseFloat(stopLoss);
      const tp = parseFloat(takeProfit);

      if (!pos && parsed.action === "COMPRAR" && parsed.confidence >= 65) {
        const size = Math.min(parsed.size || cap * 0.8, cap * 0.9);
        const newPos = { asset, type: "COMPRA", entryPrice: price, size, sl: price * (1 - sl/100), tp: price * (1 + tp/100), openedAt: Date.now() };
        setPosition(newPos); positionRef.current = newPos;
        setAlert({ signal: "COMPRA", title: "▲ IA ABRIU COMPRA", message: `${asset} @ ${fmt(price)} — ${parsed.reasoning}` });

        // Email ao abrir compra
        if (emailEnabledRef.current) {
          const sent = await sendEmailNotification({
            tipo_sinal: "▲ SINAL DE COMPRA",
            ativo: asset, preco: fmt(price),
            stop_loss: fmt(price * (1 - sl/100)),
            take_profit: fmt(price * (1 + tp/100)),
            confianca: parsed.confidence,
            analise: parsed.fullReasoning || parsed.reasoning,
          });
          setEmailStatus(sent ? "📧 Email enviado!" : "⚠️ Erro no email");
          setTimeout(() => setEmailStatus(""), 5000);
        }

      } else if (!pos && parsed.action === "VENDER" && parsed.confidence >= 65) {
        const size = Math.min(parsed.size || cap * 0.8, cap * 0.9);
        const newPos = { asset, type: "VENDA", entryPrice: price, size, sl: price * (1 + sl/100), tp: price * (1 - tp/100), openedAt: Date.now() };
        setPosition(newPos); positionRef.current = newPos;
        setAlert({ signal: "VENDA", title: "▼ IA ABRIU VENDA", message: `${asset} @ ${fmt(price)} — ${parsed.reasoning}` });

        // Email ao abrir venda
        if (emailEnabledRef.current) {
          const sent = await sendEmailNotification({
            tipo_sinal: "▼ SINAL DE VENDA",
            ativo: asset, preco: fmt(price),
            stop_loss: fmt(price * (1 + sl/100)),
            take_profit: fmt(price * (1 - tp/100)),
            confianca: parsed.confidence,
            analise: parsed.fullReasoning || parsed.reasoning,
          });
          setEmailStatus(sent ? "📧 Email enviado!" : "⚠️ Erro no email");
          setTimeout(() => setEmailStatus(""), 5000);
        }

      } else if (pos && parsed.action === "FECHAR") {
        closePosition("IA decidiu fechar", price);
      }

    } catch (e) { console.error("Erro IA:", e.message); setStatus(`Erro: ${e.message}`); }
    finally { setLoadingAI(false); }
  }, [asset, stopLoss, takeProfit, trades.length, closePosition, startCountdown]);

  useEffect(() => {
    setCandles([]); setCurrentPrice(null); setIndicators(null);
    fetchCandles(asset); fetchAllPrices();
  }, [asset, fetchCandles, fetchAllPrices]);

  useEffect(() => {
    if (!running) return;
    const start = async () => { const d = await fetchCandles(asset); if (d) await analyzeAndTrade(); };
    start();
    const dataInt = setInterval(() => fetchCandles(asset), 120000);
    const aiInt = setInterval(() => analyzeAndTrade(), AI_INTERVAL * 1000);
    const priceInt = setInterval(fetchAllPrices, 30000);
    return () => { clearInterval(dataInt); clearInterval(aiInt); clearInterval(priceInt); if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [running, asset]);

  const totalPnlColor = totalPnl >= 0 ? "#00e5a0" : "#ff4d6d";

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px" }}>
      <style>{`
        .panel { background: #0d1320; border: 1px solid #1e2d45; border-radius: 14px; padding: 20px; margin-bottom: 14px; }
        .stat  { background: #0d1320; border: 1px solid #1e2d45; border-radius: 12px; padding: 14px 18px; }
        select, input { outline: none; }
        .pulse { animation: pulse 2s infinite; } @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
      `}</style>

      {alert && <SignalAlert alert={alert} onDismiss={() => setAlert(null)} />}

      <div style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "4px" }}>🏦 <span style={{ color: "#00e5a0" }}>Paper Trading</span> — Carteira Virtual</h1>
          <p style={{ color: "#444", fontSize: "13px" }}>IA opera automaticamente · Capital: R$ 1.000,00 · Groq LLaMA 3.3 70B</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {emailStatus && <span style={{ color: "#00e5a0", fontSize: "12px", fontFamily: "monospace" }}>{emailStatus}</span>}
          {running && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#0d1320", border: "1px solid #00e5a033", borderRadius: "8px", padding: "8px 14px" }}>
              <div className="pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", background: loadingAI ? "#ffd60a" : "#00e5a0" }} />
              <span style={{ color: loadingAI ? "#ffd60a" : "#00e5a0", fontSize: "12px", fontFamily: "monospace" }}>{status}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "12px", marginBottom: "16px" }}>
        {[
          { label: "CAPITAL ATUAL", value: fmt(capital), sub: pct(totalPnlPct), color: totalPnlColor },
          { label: "P&L TOTAL", value: `${totalPnl >= 0 ? "+" : ""}${fmt(totalPnl)}`, sub: "desde o início", color: totalPnlColor },
          { label: "P&L HOJE", value: `${dailyPnl >= 0 ? "+" : ""}${fmt(dailyPnl)}`, sub: `${trades.length} operações`, color: dailyPnl >= 0 ? "#00e5a0" : "#ff4d6d" },
          { label: "WIN RATE", value: `${winRate.toFixed(1)}%`, sub: `${wins.length}W / ${losses.length}L`, color: winRate >= 50 ? "#00e5a0" : trades.length === 0 ? "#555" : "#ff4d6d" },
          { label: "STATUS", value: running ? (position ? `🟡 ${position.type}` : "🟢 ATIVO") : "⚪ PARADO", sub: position ? `${position.asset} aberto` : "sem posição", color: running ? "#00e5a0" : "#555" },
        ].map((s, i) => (
          <div key={i} className="stat">
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "4px" }}>{s.label}</div>
            <div style={{ color: s.color, fontSize: "17px", fontWeight: "700" }}>{s.value}</div>
            <div style={{ color: "#444", fontSize: "11px", marginTop: "2px" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "16px" }}>
        <div>
          <div className="panel">
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "12px" }}>CONFIGURAÇÃO</div>
            <div style={{ marginBottom: "10px" }}>
              <label style={{ display: "block", color: "#666", fontSize: "11px", marginBottom: "5px" }}>Ativo</label>
              <select value={asset} onChange={e => setAsset(e.target.value)} disabled={running}
                style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", fontFamily: "monospace" }}>
                {ASSETS.map(a => <option key={a} value={a}>{a} {allPrices[a] ? `· R$${allPrices[a].price?.toFixed(2)}` : ""}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              {[{ label: "Stop Loss %", val: stopLoss, set: setStopLoss }, { label: "Take Profit %", val: takeProfit, set: setTakeProfit }].map((f, i) => (
                <div key={i}>
                  <label style={{ display: "block", color: "#666", fontSize: "11px", marginBottom: "5px" }}>{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)} disabled={running} step="0.5"
                    style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#e0e6f0", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", fontFamily: "monospace" }} />
                </div>
              ))}
            </div>

            {/* Toggle Email */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#111a27", borderRadius: "8px", padding: "10px 12px", marginBottom: "12px" }}>
              <div>
                <div style={{ color: "#888", fontSize: "11px" }}>📧 Notificações por email</div>
                <div style={{ color: "#444", fontSize: "10px" }}>Avisa quando a IA operar</div>
              </div>
              <button onClick={() => setEmailEnabled(e => !e)}
                style={{ background: emailEnabled ? "#00e5a022" : "#111a27", border: `1px solid ${emailEnabled ? "#00e5a0" : "#1e2d45"}`, color: emailEnabled ? "#00e5a0" : "#555", borderRadius: "6px", padding: "5px 12px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>
                {emailEnabled ? "ON ✓" : "OFF"}
              </button>
            </div>

            <button onClick={() => setRunning(r => !r)}
              style={{ width: "100%", marginBottom: "8px", background: running ? "#ff4d6d22" : "linear-gradient(135deg,#00e5a0,#00b07a)", color: running ? "#ff4d6d" : "#000", border: running ? "1px solid #ff4d6d55" : "none", borderRadius: "10px", padding: "12px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>
              {running ? "⏹ PARAR" : "▶ INICIAR PAPER TRADING"}
            </button>
            <button onClick={() => { if (running) return; setCapital(CAPITAL_INICIAL); capitalRef.current = CAPITAL_INICIAL; setPosition(null); positionRef.current = null; setTrades([]); setEquityCurve([{ date: "início", value: CAPITAL_INICIAL }]); setLastAnalysis(null); setAnalysisHistory([]); setStatus("Carteira resetada"); setCountdown(0); }} disabled={running}
              style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#555", borderRadius: "8px", padding: "8px", fontSize: "12px", cursor: running ? "not-allowed" : "pointer" }}>
              🔄 Resetar carteira
            </button>
          </div>

          {equityCurve.length > 1 && (
            <div className="panel">
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "8px" }}>CURVA DE EQUITY</div>
              <MiniEquity data={equityCurve} width={240} height={55} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px" }}>
                <span style={{ color: "#333", fontSize: "10px", fontFamily: "monospace" }}>{fmt(CAPITAL_INICIAL)}</span>
                <span style={{ color: totalPnlColor, fontSize: "10px", fontFamily: "monospace", fontWeight: "700" }}>{fmt(capital)}</span>
              </div>
            </div>
          )}

          <div className="panel">
            <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "10px" }}>MERCADO AO VIVO ⚡</div>
            {ASSETS.slice(0, 7).map(a => {
              const p = allPrices[a];
              return (
                <div key={a} onClick={() => !running && setAsset(a)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #0d1827", cursor: running ? "default" : "pointer" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "12px", color: a === asset ? "#00e5a0" : "#777", fontWeight: a === asset ? "700" : "400" }}>{a}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "monospace", fontSize: "11px", color: "#ccc" }}>{p?.price ? `R$ ${p.price.toFixed(2)}` : "..."}</div>
                    {p?.change !== undefined && <div style={{ fontSize: "10px", color: p.change >= 0 ? "#00e5a0" : "#ff4d6d" }}>{p.change >= 0 ? "+" : ""}{p.change.toFixed(2)}%</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          {position ? (
            <PositionCard position={position} currentPrice={currentPrice || position.entryPrice} onClose={() => closePosition("Manual", currentPrice)} />
          ) : (
            <div className="panel" style={{ textAlign: "center", padding: "20px", marginBottom: "14px" }}>
              <div style={{ fontSize: "28px", marginBottom: "6px" }}>◯</div>
              <div style={{ color: "#333", fontSize: "13px" }}>Sem posição aberta</div>
              <div style={{ color: "#2a2a2a", fontSize: "11px", marginTop: "4px" }}>{running ? "IA monitorando o mercado..." : "Clique em Iniciar para a IA começar a operar"}</div>
            </div>
          )}

          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div>
                <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "4px" }}>{asset} · 5 MIN · TEMPO REAL ⚡</div>
                <div style={{ color: currentPrice ? "#00e5a0" : "#555", fontSize: "24px", fontWeight: "700", fontFamily: "monospace" }}>{currentPrice ? fmt(currentPrice) : "Carregando..."}</div>
                {lastUpdate && <div style={{ color: "#333", fontSize: "10px", fontFamily: "monospace", marginTop: "2px" }}>atualizado {lastUpdate}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                {loadingData && <div style={{ color: "#555", fontSize: "11px" }}>🔄 buscando...</div>}
                {loadingAI && <div className="pulse" style={{ color: "#ffd60a", fontSize: "11px" }}>🤖 IA analisando...</div>}
                <div style={{ color: "#2a2a2a", fontSize: "10px", fontFamily: "monospace", marginTop: "4px" }}>{candles.length} candles</div>
              </div>
            </div>
            <CandleChart candles={candles} width={680} height={150} />
          </div>

          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em" }}>HISTÓRICO DE OPERAÇÕES</div>
              {trades.length > 0 && <div style={{ display: "flex", gap: "12px" }}><span style={{ color: "#00e5a0", fontSize: "11px", fontFamily: "monospace" }}>{wins.length} lucros</span><span style={{ color: "#ff4d6d", fontSize: "11px", fontFamily: "monospace" }}>{losses.length} perdas</span></div>}
            </div>
            <TradeHistory trades={trades} />
          </div>
        </div>
      </div>

      <AnalysisPanel analysis={lastAnalysis} indicators={indicators} countdown={countdown} analysisHistory={analysisHistory} />

      <div style={{ padding: "10px 16px", background: "#0d1320", border: "1px solid #ffd60a22", borderRadius: "10px", marginTop: "14px" }}>
        <span style={{ color: "#555", fontSize: "11px" }}>
          <strong style={{ color: "#ffd60a" }}>⚠️</strong> Paper Trading usa capital fictício. Nenhuma ordem real enviada. IA: Groq LLaMA 3.3 70B · Preços: Brapi.dev ⚡
        </span>
      </div>
    </div>
  );
}
