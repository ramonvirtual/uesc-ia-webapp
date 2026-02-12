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

console.log("🎓 SISTEMA OFICIAL UESCCIC (FAQ + RAG + LOGIN SEGURO)");

const app = express();
app.use(express.json());
app.use(express.static("public"));

/* =====================================================
   SESSION CONFIG
===================================================== */

app.use(session({
  secret: "uesc_cic_secret_2026",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

const PORT = 3001;

/* =====================================================
   CONEXÃO MYSQL
===================================================== */

const db = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "uesc_ia"
});

console.log("🗄️ Banco conectado com sucesso");

/* =====================================================
   OPENAI
===================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* =====================================================
   MIDDLEWARE DE AUTENTICAÇÃO
===================================================== */

function autenticar(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

/* =====================================================
   LOGIN SEGURO COM BCRYPT
===================================================== */

app.post("/login", async (req, res) => {

  try {

    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: "Credenciais inválidas." });
    }

    const [rows] = await db.execute(
      "SELECT * FROM usuarios WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Usuário não encontrado." });
    }

    const usuario = rows[0];

    const senhaValida = await bcrypt.compare(senha, usuario.senha);

    if (!senhaValida) {
      return res.status(401).json({ error: "Senha incorreta." });
    }

    req.session.usuario = {
      id: usuario.id,
      email: usuario.email
    };

    console.log("🔐 Login realizado:", email);

    res.json({ status: true });

  } catch (error) {

    console.error("🔥 ERRO LOGIN:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

/* =====================================================
   VERIFICAR AUTH
===================================================== */

app.get("/verificar-auth", (req, res) => {
  if (req.session.usuario) {
    res.json({ autorizado: true });
  } else {
    res.status(401).json({ autorizado: false });
  }
});

/* =====================================================
   LOGOUT
===================================================== */

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ status: "Logout realizado" });
  });
});

/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */

function dividirTexto(texto, tamanho = 300) {
  const partes = [];
  for (let i = 0; i < texto.length; i += tamanho) {
    partes.push(texto.slice(i, i + tamanho));
  }
  return partes;
}

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/* =====================================================
   UPLOAD PDF (PROTEGIDO)
===================================================== */

const upload = multer({ dest: "uploads/" });

app.post("/upload-pdf", autenticar, upload.single("arquivo"), async (req, res) => {

  try {

    if (!req.file) {
      return res.status(400).json({ error: "Arquivo não enviado." });
    }

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

    res.json({ status: "Documento institucional indexado com sucesso." });

  } catch (error) {

    console.error("🔥 ERRO UPLOAD:", error);
    res.status(500).json({ error: "Erro ao indexar PDF." });
  }
});

/* =====================================================
   LISTAR DOCUMENTOS (PROTEGIDO)
===================================================== */

app.get("/documentos", autenticar, async (req, res) => {
  const [docs] = await db.execute(
    "SELECT DISTINCT titulo FROM documentos"
  );
  res.json(docs);
});

/* =====================================================
   CHAT (FAQ + RAG)
===================================================== */

app.post("/chat", async (req, res) => {

  try {

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Mensagem vazia" });

    const pergunta = normalizar(message);

    /* FAQ */
    const [faqRows] = await db.execute("SELECT pergunta, resposta FROM faq");

    for (let item of faqRows) {

      if (pergunta.includes(normalizar(item.pergunta))) {

        const respostaIA = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: `
Utilize exclusivamente o conteúdo oficial abaixo:

${item.resposta}

Pergunta:
${message}

Responda formalmente.
`
        });

        return res.json({
          reply: respostaIA.output_text,
          fonte: "FAQ"
        });
      }
    }

    /* RAG Textual */
    const [matchTexto] = await db.execute(
      "SELECT chunk FROM documentos WHERE chunk LIKE ? LIMIT 5",
      [`%${message}%`]
    );

    if (matchTexto.length > 0) {

      const contexto = matchTexto.map(d => d.chunk).join("\n\n");

      const respostaIA = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: `
Utilize exclusivamente o conteúdo institucional abaixo:

${contexto}

Pergunta:
${message}

Responda formalmente e resumidamente.
`
      });

      return res.json({
        reply: respostaIA.output_text,
        fonte: "RAG"
      });
    }

    /* PADRÃO */
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
    res.status(500).json({ error: "Erro interno no servidor institucional." });
  }
});

/* =====================================================
   START
===================================================== */

app.listen(PORT, () => {
  console.log(`🚀 Sistema rodando em http://localhost:${PORT}`);
});
