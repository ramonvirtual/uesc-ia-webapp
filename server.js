import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import mysql from "mysql2/promise";

console.log("🔥 SERVIDOR INICIADO 🔥");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = 3001;

/* ========================
   CONEXÃO MYSQL
======================== */
const db = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "", // padrão XAMPP
  database: "uesc_ia"
});

console.log("🗄️ Conectado ao MySQL");

/* ========================
   OPENAI
======================== */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ========================
   ROTA CHAT
======================== */
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Mensagem vazia" });
    }

    console.log("📩 Pergunta:", message);

    // 🔎 BUSCA NA BASE
const [rows] = await db.execute(
  "SELECT pergunta, resposta FROM faq"
);

let contexto = "";

for (let item of rows) {
  if (message.toUpperCase().includes(item.pergunta.toUpperCase())) {
    contexto = item.resposta;
    break;
  }
}

    // 🧠 ENVIA PARA IA
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: `
      Use a base institucional abaixo se existir.

      Base:
      ${contexto}

      Pergunta do usuário:
      ${message}
      `
    });

    res.json({ reply: response.output_text });

  } catch (error) {
    console.error("🔥 ERRO:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Rodando em http://localhost:${PORT}`);
});
