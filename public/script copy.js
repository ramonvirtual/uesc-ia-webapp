/* =====================================================
   VARIÁVEIS GLOBAIS
===================================================== */

let voices = [];
let voiceEnabled = true;
let femaleVoice = null;

/* =====================================================
   CARREGAR VOZ
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

  console.log("🎙️ Voz selecionada:", femaleVoice?.name);
}

speechSynthesis.onvoiceschanged = loadVoices;

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
   FALAR
===================================================== */

function falar(texto) {

  if (!voiceEnabled || !femaleVoice) return;

  speechSynthesis.cancel();

  const mascote = document.getElementById("mascote");
  const partes = texto.match(/.{1,200}(\s|$)/g);

  partes?.forEach(parte => {

    const utterance = new SpeechSynthesisUtterance(parte);

    utterance.voice = femaleVoice;
    utterance.lang = "pt-BR";
    utterance.rate = 0.92;
    utterance.pitch = 1;

    utterance.onstart = () => mascote?.classList.add("falando");
    utterance.onend = () => mascote?.classList.remove("falando");

    speechSynthesis.speak(utterance);

  });
}

/* =====================================================
   MENSAGEM INICIAL
===================================================== */

/* =====================================================
   EXPERIÊNCIA INICIAL – ASSISTENTE VIRTUAL PROFISSIONAL
===================================================== */

window.onload = function () {

  const chatBox = document.getElementById("chat-box");

  chatBox.innerHTML += `
    <div class="message bot">

      <strong>👋 Olá! Seja bem-vindo(a) ao Assistente Virtual UescCIC</strong>
      <br><br>

      🎓 Sou o assistente institucional oficial do Curso de Ciência da Computação da UESC.
      <br><br>

      📌 Antes de iniciarmos, poderia me informar:
      <br>
      • Seu nome completo<br>
      • Sua matrícula acadêmica
      <br><br>

      📚 <strong>Posso ajudar você com:</strong>
      <br>
      • Informações sobre CONSU, CONSEPE, COLCIC<br>
      • Estatuto e Regimento da UESC<br>
      • Normas acadêmicas oficiais<br>
      • Composição de Conselhos<br>
      • Estrutura institucional<br>
      • Informações institucionais do curso
      <br><br>

      💡 <strong>Exemplos de perguntas:</strong>
      <br>
      • O que é o CONSU?<br>
      • Qual a composição do Conselho Superior?<br>
      • O que é o Regimento da UESC?<br>
      • Qual o site do COLCIC?
      <br><br>

      ✨ <strong>Como posso te ajudar hoje?</strong>

    </div>
  `;

  setTimeout(() => {
    falar("Olá! Eu sou o Assistente Virtual Institucional UescCIC. Informe seu nome e matrícula para iniciarmos o atendimento.");
  }, 800);
};

/* =====================================================
   ENVIO DA PERGUNTA
===================================================== */

async function sendMessage() {

  const input = document.getElementById("user-input");
  const chatBox = document.getElementById("chat-box");
  const message = input.value.trim();

  if (!message) return;

  chatBox.innerHTML += `<div class="message user">${message}</div>`;
  input.value = "";

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

    if (!response.ok) throw new Error("Erro servidor");

    const data = await response.json();
    chatBox.removeChild(typing);

    let badge = "";

    if (data.fonte === "FAQ") {
      badge = "📌 <em>Resposta da Base Institucional (FAQ)</em><br><br>";
    }

    if (data.fonte === "RAG") {
      badge = "📚 <em>Baseado em Documento Institucional Oficial</em><br><br>";
    }

    if (data.fonte === "BASE_OFICIAL") {
      badge = "🏛️ <em>Consulta Institucional Oficial</em><br><br>";
    }

    chatBox.innerHTML += `
      <div class="message bot">
        ${badge}
        ${data.reply}
      </div>
    `;

    falar(data.reply);

  } catch (error) {

    chatBox.removeChild(typing);

    const erroMsg =
      "⚠️ Ocorreu uma instabilidade na comunicação com o servidor institucional.";

    chatBox.innerHTML += `<div class="message bot">${erroMsg}</div>`;
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

/* =====================================================
   ENTER PARA ENVIAR
===================================================== */

document.getElementById("user-input")
  ?.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      sendMessage();
    }
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

/* =====================================================
   ENVIAR DÚVIDA (ROTA CORRIGIDA)
===================================================== */

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

    const response = await fetch("/duvida", {   // 🔥 CORRIGIDO AQUI
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ nome, matricula, email, pergunta })
    });

    const data = await response.json();

    if(response.ok){
      alert("✅ Dúvida enviada com sucesso!");
      fecharModal();

      // Limpa campos
      document.getElementById("duvidaNome").value="";
      document.getElementById("duvidaMatricula").value="";
      document.getElementById("duvidaEmail").value="";
      document.getElementById("duvidaTexto").value="";
    } else {
      alert("⚠️ " + (data.error || "Erro ao enviar dúvida."));
    }

  } catch(error){
    alert("❌ Erro de comunicação com o servidor.");
  }
}
