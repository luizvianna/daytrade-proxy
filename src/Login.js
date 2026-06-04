import { useState } from "react";

// Hash simples para não expor a senha em texto puro no bundle
const SENHA_HASH = process.env.REACT_APP_ACCESS_PASSWORD || "";

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function Login({ onLogin }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!senha) { setErro("Digite a senha!"); return; }
    setLoading(true);
    setErro("");
    try {
      const hash = await hashPassword(senha);
      if (hash === SENHA_HASH) {
        // Salva sessão por 24h
        const expiry = Date.now() + 24 * 60 * 60 * 1000;
        sessionStorage.setItem("tradeai_auth", JSON.stringify({ hash, expiry }));
        onLogin();
      } else {
        setErro("Senha incorreta. Tente novamente.");
        setSenha("");
      }
    } catch (e) {
      setErro("Erro ao verificar senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#080c14",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans','Segoe UI',sans-serif", padding: "20px"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .login-input:focus { border-color: #00e5a0 !important; box-shadow: 0 0 0 3px #00e5a022; }
        .btn-login:hover { transform: translateY(-1px); box-shadow: 0 8px 24px #00e5a044; }
        .btn-login:active { transform: translateY(0); }
        @keyframes fadeIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .card { animation: fadeIn 0.4s ease; }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
        .shake { animation: shake 0.3s ease; }
      `}</style>

      <div className="card" style={{ width: "100%", maxWidth: "400px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ width: "64px", height: "64px", background: "linear-gradient(135deg,#00e5a0,#006eff)", borderRadius: "18px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", margin: "0 auto 16px" }}>⚡</div>
          <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#fff", marginBottom: "6px" }}>
            TRADE<span style={{ color: "#00e5a0" }}>AI</span>
          </h1>
          <p style={{ color: "#444", fontSize: "13px", fontFamily: "monospace" }}>SISTEMA DE ANÁLISE B3 · ACESSO PRIVADO</p>
        </div>

        {/* Card de login */}
        <div style={{ background: "#0d1320", border: "1px solid #1e2d45", borderRadius: "16px", padding: "28px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#fff", marginBottom: "6px" }}>Bem-vindo de volta</h2>
          <p style={{ color: "#444", fontSize: "13px", marginBottom: "24px" }}>Digite sua senha para acessar o sistema</p>

          {/* Campo de senha */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", color: "#666", fontSize: "12px", marginBottom: "6px", fontFamily: "monospace", letterSpacing: "0.08em" }}>SENHA DE ACESSO</label>
            <div style={{ position: "relative" }}>
              <input
                className="login-input"
                type={showPassword ? "text" : "password"}
                value={senha}
                onChange={e => { setSenha(e.target.value); setErro(""); }}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="••••••••••"
                style={{ width: "100%", background: "#111a27", border: `1px solid ${erro ? "#ff4d6d" : "#1e2d45"}`, color: "#e0e6f0", borderRadius: "10px", padding: "13px 44px 13px 14px", fontSize: "16px", fontFamily: "monospace", outline: "none", transition: "all 0.2s" }}
              />
              <button onClick={() => setShowPassword(s => !s)}
                style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: "18px", lineHeight: 1 }}>
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          {/* Erro */}
          {erro && (
            <div className="shake" style={{ background: "#ff4d6d15", border: "1px solid #ff4d6d44", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "#ff4d6d", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>⚠️</span> {erro}
            </div>
          )}

          {/* Botão login */}
          <button className="btn-login" onClick={handleLogin} disabled={loading}
            style={{ width: "100%", background: loading ? "#555" : "linear-gradient(135deg,#00e5a0,#00b07a)", color: "#000", border: "none", borderRadius: "10px", padding: "14px", fontSize: "15px", fontWeight: "700", cursor: loading ? "not-allowed" : "pointer", transition: "all 0.2s", marginBottom: "16px" }}>
            {loading ? "⏳ Verificando..." : "🔓 Acessar Sistema"}
          </button>

          {/* Divisor */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
            <div style={{ flex: 1, height: "1px", background: "#1e2d45" }} />
            <span style={{ color: "#333", fontSize: "11px", fontFamily: "monospace" }}>EM BREVE</span>
            <div style={{ flex: 1, height: "1px", background: "#1e2d45" }} />
          </div>

          {/* Botão Google (em breve) */}
          <button disabled
            style={{ width: "100%", background: "#111a27", border: "1px solid #1e2d45", color: "#444", borderRadius: "10px", padding: "13px", fontSize: "14px", fontWeight: "600", cursor: "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px" }}>🔵</span> Continuar com Google
            <span style={{ background: "#1e2d45", color: "#555", borderRadius: "4px", padding: "2px 6px", fontSize: "10px", fontFamily: "monospace" }}>EM BREVE</span>
          </button>
        </div>

        {/* Rodapé */}
        <p style={{ textAlign: "center", color: "#2a2a2a", fontSize: "11px", marginTop: "20px", fontFamily: "monospace" }}>
          🔒 CONEXÃO SEGURA · ACESSO RESTRITO
        </p>
      </div>
    </div>
  );
}
