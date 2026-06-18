// db.js — Conexão com o banco de dados Postgres (Supabase)
//
// Usa a variável de ambiente DATABASE_URL configurada no Render.
// NUNCA exponha essa string no frontend ou em código commitado.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase exige SSL
  max: 5, // limite de conexões simultâneas (plano free do Supabase é limitado)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Erro inesperado no pool do Postgres:", err.message);
});

// ID fixo do único usuário do app (você). Quando o app tiver
// múltiplos usuários de verdade, isso vira dinâmico via auth.
const USUARIO_FIXO_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Executa uma query no banco com tratamento de erro padronizado.
 * @param {string} text - query SQL com placeholders ($1, $2...)
 * @param {Array} params - valores para os placeholders
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

/** Testa a conexão com o banco — usado no /health */
async function testarConexao() {
  try {
    await query("SELECT 1");
    return true;
  } catch (e) {
    console.error("Falha ao conectar no banco:", e.message);
    return false;
  }
}

module.exports = { query, testarConexao, USUARIO_FIXO_ID, pool };
