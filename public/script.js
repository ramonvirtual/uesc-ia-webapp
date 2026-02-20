/* =====================================================
   VARIÁVEIS GLOBAIS
===================================================== */

let voices = [];
let voiceEnabled = true;
let femaleVoice = null;

let etapaAtendimento = 1;
let nomeAluno = "";
let matriculaAluno = "";

let speaking = false;

/* =====================================================
   CARREGAR VOZES
===================================================== */

function loadVoices() {
  voices = speechSynthesis.getVoices();

  femaleVoice = voices.find(v =>
    v.lang === "pt-BR" &&
    v.name.toLowerCase().includes("google")
  );

  if (!femaleVoice) {
    femaleVoice = voices.find(v => v.lang === "pt-BR");
  }
}

speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

/* =====================================================
   TOGGLE VOZ
===================================================== */

function toggleVoice() {

  const btn = document.getElementById("voice-toggle");

  voiceEnabled = !voiceEnabled;

  if (voiceEnabled) {
    btn.textContent = "🔊 Voz ON";
    btn.classList.remove("off");
  } else {
    btn.textContent = "🔇 Voz OFF";
    btn.classList.add("off");
    speechSynthesis.cancel();
  }
}

/* =====================================================
   FALAR TEXTO (COM CONTROLE)
===================================================== */

function falar(texto) {

  if (!voiceEnabled || !femaleVoice || !texto) return;

  speechSynthesis.cancel();
  speaking = true;

  const mascote = document.getElementById("mascote");

  const partes = texto.match(/.{1,200}(\s|$)/g);

  partes?.forEach((parte, index) => {

    const utterance = new SpeechSynthesisUtterance(parte);

    utterance.voice = femaleVoice;
    utterance.lang = "pt-BR";
    utterance.rate = 0.92;
    utterance.pitch = 1;

    utterance.onstart = () => mascote?.classList.add("falando");

    utterance.onend = () => {
      if (index === partes.length - 1) {
        mascote?.classList.remove("falando");
        speaking = false;
      }
    };

    speechSynthesis.speak(utterance);

  });
}

/* =====================================================
   BOAS-VINDAS
===================================================== */

window.onload = () => {

  const chatBox = document.getElementById("chat-box");

  chatBox.innerHTML += `
    <div class="message bot">
      <strong>👋 Olá! Seja bem-vindo(a) ao Assistente Virtual UescCIC</strong>
      <br><br>
      🎓 Sou o assistente institucional oficial do Curso de Ciência da Computação da UESC.
      <br><br>
      📌 Para iniciarmos, qual é o seu <strong>nome completo</strong>?
    </div>
  `;

  falar("Olá! Seja bem-vindo ao Assistente Virtual UescCIC. Qual é o seu nome completo?");
};

/* =====================================================
   ENVIO DE MENSAGEM
===================================================== */

async function sendMessage() {

  const input = document.getElementById("user-input");
  const chatBox = document.getElementById("chat-box");
  const message = input.value.trim();

  if (!message) return;

  chatBox.innerHTML += `<div class="message user">${message}</div>`;
  input.value = "";

  chatBox.scrollTop = chatBox.scrollHeight;

  /* ETAPA 1 → NOME */

  if (etapaAtendimento === 1) {

    nomeAluno = message;
    etapaAtendimento = 2;

    const resposta = `
      Prazer, <strong>${nomeAluno}</strong> 😊<br><br>
      📌 Agora informe sua <strong>matrícula acadêmica</strong>.
    `;

    chatBox.innerHTML += `<div class="message bot">${resposta}</div>`;
    falar(`Prazer ${nomeAluno}. Agora informe sua matrícula acadêmica.`);
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }

  /* ETAPA 2 → MATRÍCULA */

  if (etapaAtendimento === 2) {

    matriculaAluno = message;
    etapaAtendimento = 3;

    const resposta = `
      ✅ Atendimento iniciado com sucesso!<br><br>
      📚 Posso ajudar você com:<br>
      • CONSU, CONSEPE, COLCIC<br>
      • Estatuto e Regimento da UESC<br>
      • Normas acadêmicas oficiais<br>
      • Estrura institucional<br><br>
      ✨ <strong>Qual é a sua dúvida?</strong>
    `;

    chatBox.innerHTML += `<div class="message bot">${resposta}</div>`;
    falar("Atendimento iniciado com sucesso. Como posso ajudar você hoje?");
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }

  /* CHAT NORMAL */

  const typing = document.createElement("div");
  typing.className = "message bot";
  typing.innerHTML = "⌛ Consultando base institucional...";
  chatBox.appendChild(typing);

  chatBox.scrollTop = chatBox.scrollHeight;

  try {

    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    if (!response.ok) throw new Error();

    const data = await response.json();

    if (typing.parentNode) chatBox.removeChild(typing);

    let badge = "";

    if (data.fonte === "FAQ")
      badge = "📌 <em>Resposta da Base Institucional (FAQ)</em><br><br>";

    if (data.fonte === "RAG")
      badge = "📚 <em>Baseado em Documento Institucional Oficial</em><br><br>";

    if (data.fonte === "BASE_OFICIAL")
      badge = "🏛️ <em>Consulta Institucional Oficial</em><br><br>";

    chatBox.innerHTML += `
      <div class="message bot">
        ${badge}
        ${data.reply}
      </div>
    `;

    falar(data.reply);

  } catch {

    if (typing.parentNode) chatBox.removeChild(typing);

    chatBox.innerHTML += `
      <div class="message bot">
        ⚠️ Ocorreu uma instabilidade na comunicação com o servidor institucional.
      </div>
    `;
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

/* =====================================================
   ENTER PARA ENVIAR
===================================================== */

document.getElementById("user-input")
  ?.addEventListener("keypress", e => {
    if (e.key === "Enter") sendMessage();
  });

/* =====================================================
   MODAL DÚVIDA
===================================================== */

function abrirModalDuvida(){
  document.getElementById("modalDuvida").style.display="flex";
}

function fecharModal(){
  document.getElementById("modalDuvida").style.display="none";
}

async function enviarDuvida(){

  const nome = document.getElementById("duvidaNome").value.trim();
  const matricula = document.getElementById("duvidaMatricula").value.trim();
  const email = document.getElementById("duvidaEmail").value.trim();
  const pergunta = document.getElementById("duvidaTexto").value.trim();

  if(!nome || !matricula || !email || !pergunta){
    alert("Preencha todos os campos.");
    return;
  }

  try {

    const response = await fetch("/registrar-duvida", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ nome, matricula, email, pergunta })
    });

    const data = await response.json();

    if(response.ok){
      alert("✅ Dúvida enviada com sucesso!");
      fecharModal();

      document.getElementById("duvidaNome").value="";
      document.getElementById("duvidaMatricula").value="";
      document.getElementById("duvidaEmail").value="";
      document.getElementById("duvidaTexto").value="";
    } else {
      alert("⚠️ " + (data.error || "Erro ao enviar dúvida."));
    }

  } catch {
    alert("❌ Erro de comunicação com o servidor.");
  }
}