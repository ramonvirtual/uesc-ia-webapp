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

console.log("🎓 SISTEMA OFICIAL UESCCIC (RAG INSTITUCIONAL PRODUÇÃO)");

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
    secure: false, // usar true apenas em HTTPS
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 4
  }
}));

app.use(express.static("public"));

const PORT = 3001;

/* =====================================================
   BANCO
===================================================== 

const db = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "uesc_ia"
});
*/

const db = await mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
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

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, "")
    .trim();
}

function extrairPalavraChave(texto) {
  const stopWords = [
    "o","que","é","e","me","fale","sobre",
    "explique","qual","significado","de",
    "do","da","dos","das"
  ];

  const palavras = normalizar(texto).split(" ");
  return palavras.filter(p => !stopWords.includes(p)).join(" ");
}

function similaridadeTexto(a, b) {
  const A = normalizar(a);
  const B = normalizar(b);

  if (A.includes(B) || B.includes(A)) return 1;

  const palavrasA = A.split(" ");
  const palavrasB = B.split(" ");

  let iguais = palavrasA.filter(p => palavrasB.includes(p)).length;
  return iguais / Math.max(palavrasA.length, palavrasB.length);
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

    if (!email || !senha)
      return res.status(400).json({ error: "Credenciais inválidas." });

    const [rows] = await db.execute(
      "SELECT * FROM usuarios WHERE email = ? LIMIT 1",
      [email]
    );

    if (!rows.length)
      return res.status(401).json({ error: "Usuário não encontrado." });

    const senhaValida = await bcrypt.compare(senha, rows[0].senha);

    if (!senhaValida)
      return res.status(401).json({ error: "Senha incorreta." });

    req.session.usuario = { id: rows[0].id, email };

    res.json({ status: true });

  } catch (error) {
    console.error("🔥 ERRO LOGIN:", error);
    res.status(500).json({ error: "Erro interno." });
  }
});

/* =====================================================
   VERIFICAR AUTH
===================================================== */

app.get("/verificar-auth", (req, res) => {
  if (req.session.usuario)
    return res.json({ autorizado: true });

  return res.status(401).json({ autorizado: false });
});

/* =====================================================
   REGISTRAR DÚVIDA
===================================================== */

app.post("/registrar-duvida", async (req, res) => {

  try {

    const { nome, matricula, email, pergunta } = req.body;

    if (!nome || !matricula || !email || !pergunta) {
      return res.status(400).json({
        error: "Todos os campos são obrigatórios."
      });
    }

    await db.execute(
      "INSERT INTO duvidas (nome, matricula, email, pergunta) VALUES (?, ?, ?, ?)",
      [nome, matricula, email, pergunta]
    );

    console.log("📩 Nova dúvida registrada:", nome);

    return res.json({ status: true });

  } catch (error) {

    console.error("🔥 ERRO AO REGISTRAR DÚVIDA:", error);

    return res.status(500).json({
      error: "Erro interno ao registrar dúvida."
    });
  }

});

/* =====================================================
   UPLOAD PDF (ADMIN)
===================================================== */

const upload = multer({ dest: "uploads/" });

app.post("/upload-pdf", autenticar, upload.single("arquivo"), async (req, res) => {

  try {

    if (!req.file)
      return res.status(400).json({ error: "Arquivo não enviado." });

    const buffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(buffer);

    const texto = data.text;
    const partes = texto.match(/.{1,500}(\s|$)/g);

    for (let chunk of partes) {

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

    res.json({ status: true });

  } catch (error) {
    console.error("🔥 ERRO UPLOAD:", error);
    res.status(500).json({ error: "Erro ao processar PDF." });
  }
});

/* =====================================================
   LISTAR DOCUMENTOS
===================================================== */

app.get("/documentos", autenticar, async (req, res) => {
  const [docs] = await db.execute(
    "SELECT DISTINCT titulo FROM documentos"
  );
  res.json(docs);
});

/* =====================================================
   CHAT RAG INSTITUCIONAL COMPLETO
===================================================== */

app.post("/chat", async (req, res) => {

  try {

    const { message } = req.body;
    if (!message)
      return res.status(400).json({ error: "Mensagem vazia" });

    const perguntaNormalizada = normalizar(message);
    const palavraChave = extrairPalavraChave(message);

    /* 1️⃣ FAQ EXATO */
    const [faqRows] = await db.execute("SELECT pergunta, resposta FROM faq");

    for (let item of faqRows) {
      if (normalizar(item.pergunta) === perguntaNormalizada) {
        return res.json({ reply: item.resposta, fonte: "FAQ" });
      }
    }

    /* 2️⃣ FAQ APROXIMADO */
    let melhorFAQ = null;
    let melhorScore = 0;

    for (let item of faqRows) {
      const score = similaridadeTexto(item.pergunta, message);
      if (score > melhorScore) {
        melhorScore = score;
        melhorFAQ = item;
      }
    }

    if (melhorScore >= 0.6) {
      return res.json({ reply: melhorFAQ.resposta, fonte: "FAQ" });
    }

    /* 3️⃣ BUSCA TEXTUAL */
    const [matchTexto] = await db.execute(
      "SELECT chunk FROM documentos WHERE LOWER(chunk) LIKE ? LIMIT 5",
      [`%${palavraChave}%`]
    );

    if (matchTexto.length) {

      const contexto = matchTexto.map(d => d.chunk).join("\n\n");

      try {

        const respostaIA = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: `
Responda exclusivamente com base no conteúdo abaixo:

${contexto}

Pergunta:
${message}

Resposta institucional clara e objetiva:
`
        });

        return res.json({
          reply: respostaIA.output_text,
          fonte: "RAG"
        });

      } catch {

        return res.json({
          reply: contexto.substring(0, 1200),
          fonte: "RAG"
        });
      }
    }

    /* 4️⃣ FALLBACK */
    return res.json({
      reply: `
🏛️ <strong>Consulta Institucional Oficial</strong><br><br>

📌 A informação não foi localizada diretamente na base institucional.<br><br>

📌 <strong>Sugestões:</strong><br>
• Use o termo principal (ex: CONSU, COLCIC, CONSEPE)<br>
• Pergunte: "O que é CONSU?"<br>
• Pergunte: "Qual a composição do Conselho Superior?"<br><br>

🔎 Termo identificado: ${palavraChave.toUpperCase()}
`,
      fonte: "BASE_OFICIAL"
    });

  } catch (error) {
    console.error("🔥 ERRO CHAT:", error);
    res.status(500).json({ error: "Erro interno." });
  }
});

/* =====================================================
   START
===================================================== */

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  });
}

export default app;


/* =====================================================
   ADMIN – LISTAR DÚVIDAS
===================================================== */

app.get("/admin/duvidas", autenticar, async (req, res) => {

  try {

    const [rows] = await db.execute(
      "SELECT id, nome, matricula, email, pergunta, data_envio FROM duvidas ORDER BY id DESC"
    );

    res.json(rows);

  } catch (error) {
    console.error("🔥 ERRO LISTAR DÚVIDAS:", error);
    res.status(500).json({ error: "Erro ao buscar dúvidas." });
  }
});

/* =====================================================
   ADMIN – EXCLUIR DÚVIDA
===================================================== */

app.delete("/admin/duvidas/:id", autenticar, async (req, res) => {

  try {

    await db.execute(
      "DELETE FROM duvidas WHERE id = ?",
      [req.params.id]
    );

    res.json({ status: true });

  } catch (error) {
    console.error("🔥 ERRO EXCLUIR DÚVIDA:", error);
    res.status(500).json({ error: "Erro ao excluir dúvida." });
  }
});

