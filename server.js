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

console.log("🎓 SISTEMA OFICIAL UESCCIC (RAG INSTITUCIONAL)");

const app = express();
const PORT = process.env.PORT || 3000;

/* =====================================================
   MIDDLEWARES
===================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: "uesc_session",
  secret: process.env.SESSION_SECRET || "uesc_cic_secret_2026",
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

/* =====================================================
   MYSQL
===================================================== */

let db;

try {
  db = await mysql.createConnection({
    host: process.env.MYSQLHOST || "localhost",
    user: process.env.MYSQLUSER || "root",
    password: process.env.MYSQLPASSWORD || "",
    database: process.env.MYSQLDATABASE || "uesc_ia",
    port: process.env.MYSQLPORT || 3306
  });

  console.log("🗄️ Banco conectado!");

} catch (error) {
  console.error("❌ ERRO MYSQL:", error.message);
  process.exit(1);
}

/* =====================================================
   OPENAI
===================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* =====================================================
   FUNÇÕES INTELIGENTES
===================================================== */

function autenticar(req, res, next) {
  if (!req.session.usuario)
    return res.status(401).json({ error: "Não autorizado" });
  next();
}

function normalizar(texto) {
  return texto.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* INTENÇÕES ESPECÍFICAS */

const intencoes = {

  vice_coordenador: [
    "vice coordenador",
    "subcoordenador",
    "vice da coordenação",
    "vice coordenação"
  ],

  coordenador: [
    "coordenador",
    "coordenação",
    "quem coordena",
    "responsável pela coordenação"
  ],

  colegiado: ["colegiado","colcic"],
  consu: ["consu","conselho superior"],
  consepe: ["consepe"],
  carga_horaria: ["carga horaria","horas complementares"]
};

function detectarIntencao(texto){
  const t = normalizar(texto);

  // prioridade específica
  const prioridade = ["vice_coordenador", "coordenador"];

  for(const chave of prioridade){
    if(intencoes[chave].some(p => t.includes(p))){
      return chave;
    }
  }

  for(const chave in intencoes){
    if(intencoes[chave].some(p => t.includes(p))){
      return chave;
    }
  }

  return null;
}

function extrairPalavraChave(texto) {
  const stopWords = ["o","que","é","e","me","fale","sobre","explique","qual","de","do","da"];
  return normalizar(texto)
    .split(" ")
    .filter(p => !stopWords.includes(p))
    .join(" ");
}

function similaridadeTexto(a, b) {
  const A = normalizar(a);
  const B = normalizar(b);

  if (A.includes(B) || B.includes(A)) return 1;

  const pa = A.split(" ");
  const pb = B.split(" ");
  const iguais = pa.filter(p => pb.includes(p)).length;
  return iguais / Math.max(pa.length, pb.length);
}

/* =====================================================
   LOGIN
===================================================== */

app.post("/login", async (req,res)=>{
  const { email, senha } = req.body;

  const [rows] = await db.execute(
    "SELECT * FROM usuarios WHERE email=? LIMIT 1",
    [email]
  );

  if(!rows.length)
    return res.status(401).json({ error:"Usuário não encontrado" });

  const ok = await bcrypt.compare(senha, rows[0].senha);

  if(!ok)
    return res.status(401).json({ error:"Senha incorreta" });

  req.session.usuario = { id: rows[0].id, email };

  res.json({ status:true });
});

app.get("/logout",(req,res)=>{
  req.session.destroy(()=> res.redirect("/login.html"));
});

app.get("/verificar-auth",(req,res)=>{
  if(req.session.usuario)
    return res.json({ autorizado:true });
  res.status(401).json({ autorizado:false });
});

/* =====================================================
   FAQ PROTEGIDO
===================================================== */

app.post("/faq", autenticar, async (req,res)=>{
  const { pergunta, resposta } = req.body;

  if(!pergunta || !resposta)
    return res.status(400).json({error:"Campos obrigatórios"});

  await db.execute(
    "INSERT INTO faq (pergunta,resposta) VALUES (?,?)",
    [pergunta,resposta]
  );

  res.json({status:true});
});

/* =====================================================
   REGISTRAR DÚVIDA
===================================================== */

app.post("/registrar-duvida", async (req,res)=>{
  const { nome, matricula, email, pergunta } = req.body;

  await db.execute(
    "INSERT INTO duvidas (nome, matricula, email, pergunta) VALUES (?,?,?,?)",
    [nome, matricula, email, pergunta]
  );

  res.json({status:true});
});

/* =====================================================
   ADMIN DÚVIDAS
===================================================== */

app.get("/admin/duvidas", autenticar, async (req,res)=>{
  const [rows] = await db.execute(
    "SELECT * FROM duvidas ORDER BY id DESC"
  );
  res.json(rows);
});

app.delete("/admin/duvidas/:id", autenticar, async (req,res)=>{
  await db.execute("DELETE FROM duvidas WHERE id=?", [req.params.id]);
  res.json({status:true});
});

/* =====================================================
   UPLOAD PDF (RAG)
===================================================== */

const upload = multer({ dest:"uploads/" });

app.post("/upload-pdf", autenticar, upload.single("arquivo"), async (req,res)=>{
  const buffer = fs.readFileSync(req.file.path);
  const data = await pdfParse(buffer);
  const partes = data.text.match(/.{1,500}(\s|$)/g);

  for(const chunk of partes){
    const emb = await openai.embeddings.create({
      model:"text-embedding-3-small",
      input:chunk
    });

    await db.execute(
      "INSERT INTO documentos (titulo,chunk,embedding) VALUES (?,?,?)",
      [req.file.originalname,chunk,JSON.stringify(emb.data[0].embedding)]
    );
  }

  fs.unlinkSync(req.file.path);
  res.json({status:true});
});

/* =====================================================
   CHAT RAG INTELIGENTE
===================================================== */

app.post("/chat", async (req,res)=>{
  try{

    const { message } = req.body;

    const intencao = detectarIntencao(message);
    const perguntaUser = normalizar(message);
    const palavra = intencao || extrairPalavraChave(message);

    const [faqRows] = await db.execute("SELECT pergunta,resposta FROM faq");

    /* MATCH POR INTENÇÃO */
    if(intencao){
      const match = faqRows.find(f =>
        normalizar(f.pergunta).includes(intencao.replace("_"," "))
      );

      if(match){
        return res.json({ reply:match.resposta, fonte:"FAQ" });
      }
    }

    /* MATCH SEMÂNTICO */
    let melhor = null;
    let scoreMax = 0;

    for(const f of faqRows){
      const score = similaridadeTexto(f.pergunta, perguntaUser);
      if(score > scoreMax){
        scoreMax = score;
        melhor = f;
      }
    }

    if(scoreMax >= 0.45){
      return res.json({ reply:melhor.resposta, fonte:"FAQ" });
    }

    /* BUSCA DOCUMENTOS */
    const [docs] = await db.execute(
      "SELECT chunk FROM documentos WHERE LOWER(chunk) LIKE ? LIMIT 5",
      [`%${palavra}%`]
    );

    if(docs.length){
      const contexto = docs.map(d=>d.chunk).join("\n");

      const resposta = await openai.responses.create({
        model:"gpt-4.1-mini",
        input:`
Responda como assistente institucional oficial da UESC.

Use apenas o conteúdo abaixo:

${contexto}

Pergunta:
${message}
`
      });

      return res.json({ reply:resposta.output_text, fonte:"RAG" });
    }

    /* IA PARA PERGUNTAS AMBÍGUAS */
    const respostaIA = await openai.responses.create({
      model:"gpt-4.1-mini",
      input:`
Você é assistente institucional da UESC.

Pergunta do aluno:
"${message}"

Coordenação atual:
- Coordenadora: Marta Magda Dornelles
- Vice-coordenador: Jorge Lima de Oliveira Filho

Responda corretamente conforme o cargo solicitado.
`
    });

    return res.json({
      reply: respostaIA.output_text,
      fonte:"IA_INSTITUCIONAL"
    });

  }catch(err){
    console.error(err);
    res.status(500).json({error:"Erro interno"});
  }
});

/* =====================================================
   START
===================================================== */

app.listen(PORT, ()=>{
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});