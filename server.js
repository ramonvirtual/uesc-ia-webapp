import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import mysql from "mysql2/promise";
import multer from "multer";
import fs from "fs";
import pkg from "pdf-parse";

const pdfParse = pkg;

dotenv.config();

console.log("🔥 SERVIDOR UESCCIC DEFINITIVO 🔥");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = 3001;

/* =========================
   MYSQL
========================= */

const db = await mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "uesc_ia"
});

console.log("🗄️ MySQL conectado");

/* =========================
   OPENAI
========================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* =========================
   FUNÇÕES AUXILIARES
========================= */

function dividirTexto(texto, tamanho = 700) {
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

/* =========================
   UPLOAD PDF
========================= */

const upload = multer({ dest: "uploads/" });

app.post("/upload-pdf", upload.single("arquivo"), async (req, res) => {

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

    res.json({ status: "PDF indexado com sucesso" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao processar PDF" });
  }
});

/* =========================
   CHAT INTELIGENTE
========================= */

app.post("/chat", async (req, res) => {

  try {

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Mensagem vazia" });

    console.log("📩 Pergunta:", message);
    const mensagemLower = message.toLowerCase();

    /* ====================================================
       1️⃣ DETECÇÃO DE LINK (PRIORIDADE TOTAL)
    ==================================================== */

    const perguntaLink =
      mensagemLower.includes("link") ||
      mensagemLower.includes("site") ||
      mensagemLower.includes("url") ||
      mensagemLower.includes("endereço");

    if (perguntaLink) {

      console.log("🌐 LINK detectado → WEB_OFICIAL");

      const respostaWeb = await openai.responses.create({
        model: "gpt-4.1-mini",
        tools: [{ type: "web_search" }],
        input: `
        Pesquise exclusivamente nos domínios:

        site:uesc.br
        site:colcic.uesc.br

        Pergunta:
        ${message}

        Se encontrar, retorne apenas:
        LINK: <url_oficial>

        Se não encontrar, retorne:
        NAO_ENCONTRADO
        `
      });

      const textoWeb = respostaWeb.output_text.trim();

      if (!textoWeb.includes("NAO_ENCONTRADO")) {

        return res.json({
          reply: `🌐 Site oficial encontrado:\n\n${textoWeb}`,
          fonte: "WEB_OFICIAL"
        });
      }

      return res.json({
        reply: `🌐 O site oficial do COLCIC é:\nhttps://colcic.uesc.br/\n\n📌 Portal principal da UESC:\nhttps://www.uesc.br`,
        fonte: "WEB_PADRAO"
      });
    }

    /* ====================================================
       2️⃣ FAQ (MATCH EXATO)
    ==================================================== */

    const [faqRows] = await db.execute("SELECT pergunta, resposta FROM faq");

    for (let item of faqRows) {

      if (mensagemLower.trim() === item.pergunta.toLowerCase().trim()) {

        console.log("📌 Respondendo via FAQ");

        return res.json({
          reply: item.resposta,
          fonte: "FAQ"
        });
      }
    }

    /* ====================================================
       3️⃣ RAG (PDF)
    ==================================================== */

    const embeddingPergunta = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message
    });

    const vetorPergunta = embeddingPergunta.data[0].embedding;
    const [docs] = await db.execute("SELECT * FROM documentos");

    let resultados = [];

    for (let doc of docs) {

      if (!doc.embedding) continue;

      const vetorDoc = JSON.parse(doc.embedding);
      const similaridade = cosineSimilarity(vetorPergunta, vetorDoc);

      resultados.push({ doc, similaridade });
    }

    resultados.sort((a,b)=> b.similaridade - a.similaridade);
    const top5 = resultados.slice(0,5);

    console.log("📊 Similaridades:", top5.map(r=>r.similaridade));

    if (top5.length > 0 && top5[0].similaridade > 0.60) {

      const contexto = top5.map(r=>r.doc.chunk).join("\n\n");

      const respostaRAG = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: `
        Utilize exclusivamente o conteúdo abaixo:

        ${contexto}

        Pergunta:
        ${message}
        `
      });

      return res.json({
        reply: respostaRAG.output_text,
        fonte: "RAG"
      });
    }

    /* ====================================================
       4️⃣ WEB FALLBACK
    ==================================================== */

    console.log("🌐 Tentando WEB fallback");

    const respostaWebFallback = await openai.responses.create({
      model: "gpt-4.1-mini",
      tools: [{ type: "web_search" }],
      input: `
      Pesquise nos domínios:

      site:uesc.br
      site:colcic.uesc.br

      Pergunta:
      ${message}

      Se não encontrar, retorne:
      NAO_ENCONTRADO
      `
    });

    if (!respostaWebFallback.output_text.includes("NAO_ENCONTRADO")) {

      return res.json({
        reply: respostaWebFallback.output_text,
        fonte: "WEB_OFICIAL"
      });
    }

    /* ====================================================
       5️⃣ IA FINAL
    ==================================================== */

    console.log("🤖 Respondendo via IA");

    const respostaIA = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: message
    });

    return res.json({
      reply: respostaIA.output_text,
      fonte: "IA"
    });

  } catch (error) {

    console.error("🔥 ERRO:", error.message);

    res.status(500).json({
      error: "Erro interno do servidor"
    });
  }
});

/* =========================
   SERVIDOR
========================= */

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
