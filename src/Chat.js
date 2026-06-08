import { useState, useEffect, useRef, useCallback } from "react";

const PROXY = "https://daytrade-proxy.onrender.com";

const SUGESTOES = [
  "Analise PETR4 para longo prazo",
  "Quais FIIs pagam os melhores dividendos?",
  "Como os juros altos afetam minha carteira?",
  "HGLG11 vale a pena comprar agora?",
  "Qual o impacto da inflação em ETFs?",
  "Analise IVVB11 para 2026",
  "Bitcoin está em boa hora para comprar?",
  "Quais ações se beneficiam com Selic alta?",
];

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "12px 16px", background: "#0d1320", borderRadius: "12px", width: "fit-content", marginBottom: "12px" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: "7px", height: "7px", borderRadius: "50%", background: "#00e5a0",
          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`@keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.4} 50%{transform:translateY(-5px);opacity:1} }`}</style>
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: "12px" }}>
      {!isUser && (
        <div style={{ width: "30px", height: "30px", background: "linear-gradient(135deg,#00e5a0,#006eff)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", marginRight: "8px", flexShrink: 0, alignSelf: "flex-end" }}>
          🤖
        </div>
      )}
      <div style={{
        maxWidth: "80%",
        background: isUser ? "linear-gradient(135deg,#00e5a0,#00b07a)" : "#0d1320",
        border: isUser ? "none" : "1px solid #1e2d45",
        color: isUser ? "#000" : "#e0e6f0",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        padding: "12px 16px",
        fontSize: "13px",
        lineHeight: "1.7",
      }}>
        {msg.sources && msg.sources.length > 0 && (
          <div style={{ marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid #1e2d45" }}>
            <div style={{ color: "#6af", fontSize: "10px", fontFamily: "monospace", marginBottom: "4px" }}>🌐 FONTES PESQUISADAS</div>
            {msg.sources.map((s, i) => (
              <div key={i} style={{ color: "#555", fontSize: "10px", marginTop: "2px" }}>• {s}</div>
            ))}
          </div>
        )}
        <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
        {msg.analysis && (
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #1e2d4522" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {msg.analysis.recomendacao && (
                <span style={{
                  background: msg.analysis.recomendacao === "COMPRAR" ? "#00e5a022" : msg.analysis.recomendacao === "VENDER" ? "#ff4d6d22" : "#ffd60a22",
                  color: msg.analysis.recomendacao === "COMPRAR" ? "#00e5a0" : msg.analysis.recomendacao === "VENDER" ? "#ff4d6d" : "#ffd60a",
                  border: `1px solid ${msg.analysis.recomendacao === "COMPRAR" ? "#00e5a044" : msg.analysis.recomendacao === "VENDER" ? "#ff4d6d44" : "#ffd60a44"}`,
                  borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontWeight: "700", fontFamily: "monospace"
                }}>
                  {msg.analysis.recomendacao === "COMPRAR" ? "▲" : msg.analysis.recomendacao === "VENDER" ? "▼" : "◆"} {msg.analysis.recomendacao}
                </span>
              )}
              {msg.analysis.risco && (
                <span style={{ background: "#ff4d6d11", color: "#ff4d6d", border: "1px solid #ff4d6d33", borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontFamily: "monospace" }}>
                  ⚠️ Risco: {msg.analysis.risco}
                </span>
              )}
              {msg.analysis.horizonte && (
                <span style={{ background: "#6af11", color: "#6af", border: "1px solid #6af33", borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontFamily: "monospace" }}>
                  📅 {msg.analysis.horizonte}
                </span>
              )}
              {msg.analysis.score !== undefined && (
                <span style={{ background: "#ffd60a11", color: "#ffd60a", border: "1px solid #ffd60a33", borderRadius: "6px", padding: "3px 10px", fontSize: "11px", fontFamily: "monospace" }}>
                  ⭐ Score: {msg.analysis.score}/10
                </span>
              )}
            </div>
          </div>
        )}
        <div style={{ fontSize: "10px", color: isUser ? "#00000066" : "#333", marginTop: "6px", textAlign: "right", fontFamily: "monospace" }}>
          {msg.time}
        </div>
      </div>
      {isUser && (
        <div style={{ width: "30px", height: "30px", background: "#1e2d45", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", marginLeft: "8px", flexShrink: 0, alignSelf: "flex-end" }}>
          👤
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState([
    {
      id: 1, role: "assistant",
      content: "Olá! Sou sua IA de investimentos 🤖\n\nPosso te ajudar com:\n• Análise de ações, FIIs, ETFs e criptomoedas\n• Pesquisa de notícias e impacto econômico\n• Análise de longo prazo e recomendações\n• Discussão sobre juros, inflação e economia\n• Score de risco e probabilidade de ativos\n\nO que quer analisar hoje?",
      time: new Date().toLocaleTimeString("pt-BR"),
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");

    const userMsg = { id: Date.now(), role: "user", content: userText, time: new Date().toLocaleTimeString("pt-BR") };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      // Histórico da conversa para contexto
      const history = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const systemPrompt = `Você é uma IA especialista em investimentos brasileiros, cobrindo ações B3, FIIs, ETFs, renda fixa, tesouro direto e criptomoedas.

SUAS RESPONSABILIDADES:
1. Analisar ativos com visão de longo prazo (exceto quando pedido daytrade)
2. Pesquisar notícias recentes e impacto econômico
3. Avaliar riscos: juros Selic, inflação IPCA, câmbio, geopolítica
4. Dar score de 0-10 e recomendação clara quando analisar um ativo
5. Explicar como mudanças macroeconômicas afetam os ativos
6. Ser direto, prático e educativo

TIPOS DE ATIVOS:
- Ações B3: PETR4, VALE3, ITUB4, etc.
- FIIs: HGLG11, KNRI11, MXRF11, etc.
- ETFs: IVVB11, BOVA11, HASH11, etc.
- Cripto: BTC, ETH, BNB, etc.
- Renda Fixa: Tesouro IPCA+, Selic, CDB, LCI, LCA

FORMATO DE RESPOSTA:
- Use emojis para tornar mais visual
- Organize em tópicos quando necessário
- Sempre mencione riscos
- Para análises de ativos, termine com um resumo estruturado em JSON:
{"recomendacao":"COMPRAR|AGUARDAR|EVITAR","risco":"BAIXO|MÉDIO|ALTO","horizonte":"curto|médio|longo prazo","score":0-10}

CONTEXTO ECONÔMICO ATUAL BRASIL:
- Selic elevada impacta negativamente FIIs e growth stocks
- Inflação afeta poder de compra e margens
- Câmbio alto beneficia exportadoras
- Sempre considere o momento do ciclo econômico`;

      const prompt = webSearch
        ? `${userText}\n\n[INSTRUÇÃO: Pesquise na web informações recentes sobre este tema antes de responder. Mencione as fontes que usou.]`
        : userText;

      const response = await fetch(`${PROXY}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt,
          messages: [...history, { role: "user", content: prompt }],
          webSearch,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Erro na IA");

      let content = data.data?.content || data.data?.raw || "";
      let analysis = null;
      let sources = data.data?.sources || [];

      // Extrai JSON de análise se houver
      const jsonMatch = content.match(/\{[^{}]*"recomendacao"[^{}]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
          content = content.replace(jsonMatch[0], "").trim();
        } catch {}
      }

      const aiMsg = {
        id: Date.now() + 1, role: "assistant",
        content, analysis, sources,
        time: new Date().toLocaleTimeString("pt-BR"),
      };
      setMessages(prev => [...prev, aiMsg]);

    } catch (e) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: "assistant",
        content: `❌ Erro: ${e.message}\n\nTente novamente em alguns instantes.`,
        time: new Date().toLocaleTimeString("pt-BR"),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages, webSearch]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)", maxWidth: "900px", margin: "0 auto", padding: "0 12px" }}>
      <style>{`
        .chat-input:focus { border-color: #00e5a0 !important; box-shadow: 0 0 0 3px #00e5a022; }
        .send-btn:hover { background: #00b07a !important; }
        .sugestao:hover { border-color: #00e5a055 !important; background: #00e5a011 !important; color: #00e5a0 !important; }
      `}</style>

      {/* Header do chat */}
      <div style={{ padding: "14px 0", borderBottom: "1px solid #1e2d45", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "2px" }}>💬 Chat com IA de Investimentos</h2>
          <p style={{ color: "#444", fontSize: "11px" }}>Ações · FIIs · ETFs · Cripto · Economia · Longo Prazo</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: "#555", fontSize: "11px" }}>🌐 Web</span>
          <button onClick={() => setWebSearch(w => !w)}
            style={{ background: webSearch ? "#00e5a022" : "#111a27", border: `1px solid ${webSearch ? "#00e5a0" : "#1e2d45"}`, color: webSearch ? "#00e5a0" : "#555", borderRadius: "6px", padding: "5px 12px", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}>
            {webSearch ? "ON ✓" : "OFF"}
          </button>
        </div>
      </div>

      {/* Sugestões rápidas */}
      {messages.length <= 1 && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ color: "#444", fontSize: "10px", fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: "8px" }}>💡 SUGESTÕES RÁPIDAS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {SUGESTOES.map((s, i) => (
              <button key={i} className="sugestao" onClick={() => sendMessage(s)}
                style={{ background: "#0d1320", border: "1px solid #1e2d45", color: "#888", borderRadius: "20px", padding: "6px 12px", fontSize: "11px", cursor: "pointer", transition: "all 0.2s" }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mensagens */}
      <div style={{ flex: 1, overflowY: "auto", paddingRight: "4px" }}>
        {messages.map(msg => <Message key={msg.id} msg={msg} />)}
        {loading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "12px 0", borderTop: "1px solid #1e2d45" }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre ações, FIIs, ETFs, cripto, economia..."
            rows={1}
            style={{
              flex: 1, background: "#0d1320", border: "1px solid #1e2d45",
              color: "#e0e6f0", borderRadius: "12px", padding: "12px 14px",
              fontSize: "13px", outline: "none", resize: "none",
              fontFamily: "inherit", lineHeight: "1.5", transition: "all 0.2s",
              maxHeight: "120px", overflowY: "auto",
            }}
            onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
          />
          <button className="send-btn" onClick={() => sendMessage()} disabled={loading || !input.trim()}
            style={{ background: loading || !input.trim() ? "#1e2d45" : "linear-gradient(135deg,#00e5a0,#00b07a)", color: loading || !input.trim() ? "#555" : "#000", border: "none", borderRadius: "12px", padding: "12px 16px", fontSize: "18px", cursor: loading || !input.trim() ? "not-allowed" : "pointer", transition: "all 0.2s", flexShrink: 0 }}>
            {loading ? "⏳" : "➤"}
          </button>
        </div>
        <div style={{ color: "#2a2a2a", fontSize: "10px", textAlign: "center", marginTop: "6px", fontFamily: "monospace" }}>
          Enter para enviar · Shift+Enter para nova linha · {webSearch ? "🌐 Pesquisa web ativa" : "Pesquisa web desativada"}
        </div>
      </div>
    </div>
  );
}
