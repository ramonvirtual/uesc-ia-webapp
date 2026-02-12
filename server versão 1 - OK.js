import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import multer from "multer";
import fs from "fs";
import session from "express-session";
import bcrypt from "bcrypt";
import pkg from "pdf-parse";

const pdfParse = pkg;

dotenv.config();

console.log("🎓 SISTEMA UESCCIC - RAG INSTITUCIONAL AVANÇADO");

const app = express();

/* =====================================================
   MIDDLEWARES
===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: "uesc_session",
  secret: "uesc_cic_secret_2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use(express.static("public"));

const PORT = 3001;

/* =====================================================
   MYSQL
===================================================== */

const db = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "uesc_ia"
});

console.log("🗄️ Banco conectado");

/* =====================================================
   OPENAI
===================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */

function limparTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, "")
    .trim();
}

function dividirTexto(texto, tamanho = 500) {
  const partes = [];
  for (let i = 0; i < texto.length; i += tamanho) {
    partes.push(texto.slice(i, i + tamanho));
  }
  return partes;
}

function cosineSimilarity(vecA, vecB) {
  const dot = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

function autenticar(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

/* =====================================================
   LOGIN
===================================================== */

app.post("/login", async (req, res) => {

  try {

    const { email, senha } = req.body;

    const [rows] = await db.execute(
      "SELECT * FROM usuarios WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0)
      return res.status(401).json({ error: "Usuário não encontrado." });

    const usuario = rows[0];
    const senhaValida = await bcrypt.compare(senha, usuario.senha);

    if (!senhaValida)
      return res.status(401).json({ error: "Senha incorreta." });

    req.session.usuario = {
      id: usuario.id,
      email: usuario.email
    };

    return res.json({ status: true });

  } catch (error) {
    console.error("🔥 ERRO LOGIN:", error);
    return res.status(500).json({ error: "Erro interno." });
  }

});

/* =====================================================
   VERIFICAR AUTH
===================================================== */

app.get("/verificar-auth", (req, res) => {
  if (req.session.usuario) {
    return res.json({ autorizado: true });
  }
  return res.status(401).json({ autorizado: false });
});

/* =====================================================
   REGISTRAR DÚVIDA
===================================================== */

app.post("/registrar-duvida", async (req, res) => {

  try {

    const { nome, matricula, email, pergunta } = req.body;

    await db.execute(
      "INSERT INTO duvidas (nome, matricula, email, pergunta) VALUES (?, ?, ?, ?)",
      [nome, matricula, email, pergunta]
    );

    return res.json({ status: true });

  } catch (error) {
    console.error("🔥 ERRO DÚVIDA:", error);
    return res.status(500).json({ error: "Erro ao registrar dúvida." });
  }

});

/* =====================================================
   UPLOAD PDF (RAG)
===================================================== */

const upload = multer({ dest: "uploads/" });

app.post("/upload-pdf", autenticar, upload.single("arquivo"), async (req, res) => {

  try {

    const buffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(buffer);
    const chunks = dividirTexto(data.text);

    for (let chunk of chunks) {

      const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk
      });

      await db.execute(
        "INSERT INTO documentos (titulo, chunk, embedding) VALUES (?, ?, ?)",
        [
          req.file.originalname,
          chunk,
          JSON.stringify(embedding.data[0].embedding)
        ]
      );
    }

    fs.unlinkSync(req.file.path);

    return res.json({ status: true });

  } catch (error) {
    console.error("🔥 ERRO UPLOAD:", error);
    return res.status(500).json({ error: "Erro ao indexar PDF." });
  }

});

/* =====================================================
   LISTAR DOCUMENTOS
===================================================== */

app.get("/documentos", autenticar, async (req, res) => {
  const [docs] = await db.execute("SELECT DISTINCT titulo FROM documentos");
  res.json(docs);
});

/* =====================================================
   CHAT INTELIGENTE (FAQ + RAG + FALLBACK)
===================================================== */

app.post("/chat", async (req, res) => {

  try {

    const { message } = req.body;
    if (!message)
      return res.status(400).json({ error: "Mensagem vazia" });

    const perguntaLimpa = limparTexto(message);

    /* =========================
       1️⃣ PRIORIDADE FAQ
    ========================= */

    const [faq] = await db.execute("SELECT pergunta, resposta FROM faq");

    for (let item of faq) {
      if (limparTexto(item.pergunta).includes(perguntaLimpa)) {
        return res.json({
          reply: item.resposta,
          fonte: "FAQ"
        });
      }
    }

    /* =========================
       2️⃣ RAG SEMÂNTICO
    ========================= */

    const embeddingPergunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message
    });

    const vetorPergunta = embeddingPergunta.data[0].embedding;

    const [docs] = await db.execute("SELECT chunk, embedding FROM documentos");

    let melhores = [];

    for (let doc of docs) {
      if (!doc.embedding) continue;

      const vetorDoc = JSON.parse(doc.embedding);
      const similaridade = cosineSimilarity(vetorPergunta, vetorDoc);

      melhores.push({
        chunk: doc.chunk,
        similaridade
      });
    }

    melhores.sort((a, b) => b.similaridade - a.similaridade);

    if (melhores.length > 0 && melhores[0].similaridade >= 0.45) {

      const contexto = melhores.slice(0, 3)
        .map(m => m.chunk)
        .join("\n\n");

      try {

        const respostaIA = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: `
Você é um assistente institucional da UESC.
Responda exclusivamente com base no conteúdo abaixo.

${contexto}

Pergunta:
${message}

Resposta institucional:
`
        });

        return res.json({
          reply: respostaIA.output_text,
          fonte: "RAG"
        });

      } catch (gptError) {

        console.error("⚠️ GPT falhou — usando fallback.");

        return res.json({
          reply: contexto.substring(0, 1200),
          fonte: "RAG_FALLBACK"
        });
      }
    }

    /* =========================
       3️⃣ PADRÃO
    ========================= */

    return res.json({
      reply: `
🏛️ <strong>Consulta Institucional Oficial</strong><br><br>
📌 A informação solicitada não foi localizada na base institucional oficial.<br><br>
🌐 https://www.uesc.br/<br>
🎓 https://colcic.uesc.br/<br>
📧 colcic@uesc.br<br>
📞 (73) 3680-5110
`,
      fonte: "BASE_OFICIAL"
    });

  } catch (error) {

    console.error("🔥 ERRO CHAT:", error);

    return res.status(500).json({
      reply: "⚠️ Ocorreu uma instabilidade na comunicação com o servidor institucional.",
      fonte: "ERRO"
    });
  }

});

/* =====================================================
   START
===================================================== */

app.listen(PORT, () => {
  console.log(`🚀 Sistema rodando em http://localhost:${PORT}`);
});
