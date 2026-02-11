/* =====================================================
   VARIÁVEIS GLOBAIS
===================================================== */

let voices = [];
let voiceEnabled = true;
let femaleVoice = null;


/* =====================================================
   CARREGAR VOZ FEMININA (GOOGLE PRIORIDADE)
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
   FALAR COM EXPRESSÃO
===================================================== */

function falar(texto) {

  if (!voiceEnabled || !femaleVoice) return;

  speechSynthesis.cancel();

  const mascote = document.getElementById("mascote");

  const partes = texto.match(/.{1,200}(\s|$)/g);

  partes.forEach(parte => {

    const utterance = new SpeechSynthesisUtterance(parte);

    utterance.voice = femaleVoice;
    utterance.lang = "pt-BR";
    utterance.rate = 0.92; // tom institucional
    utterance.pitch = 1;

    utterance.onstart = () => {
      mascote.classList.add("falando");
    };

    utterance.onend = () => {
      mascote.classList.remove("falando");
    };

    speechSynthesis.speak(utterance);

  });
}


/* =====================================================
   MENSAGEM INICIAL INSTITUCIONAL
===================================================== */

window.onload = function () {

  const chatBox = document.getElementById("chat-box");

  const mensagem = `
  👋 <strong>Bem-vindo(a) ao Assistente Virtual UescCIC</strong><br><br>

  🎓 Informações acadêmicas<br>
  📚 Normas institucionais<br>
  🖥️ Orientações do Curso<br><br>

  ✨ Faça sua pergunta para começar.
  `;

  chatBox.innerHTML += `<div class="message bot">${mensagem}</div>`;

  setTimeout(() => {
    falar("Bem-vindo ao Assistente Virtual UescCIC. Estou pronto para auxiliá-lo com informações acadêmicas e institucionais.");
  }, 600);
};


/* =====================================================
   ENVIO DA MENSAGEM (COM SUPORTE A RAG)
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
  typing.innerHTML = "⌛ Analisando informações...";
  chatBox.appendChild(typing);

  chatBox.scrollTop = chatBox.scrollHeight;

  try {

    const response = await fetch("http://localhost:3001/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    if (!response.ok) throw new Error("Erro servidor");

    const data = await response.json();
    chatBox.removeChild(typing);

    const resposta = data.reply || 
      "Não foi possível localizar a informação solicitada no momento.";

    let badge = "";

    // 🧠 IDENTIFICA FONTE DA RESPOSTA
    if (data.fonte === "FAQ") {
      badge = "📌 <em>Resposta da base institucional</em><br><br>";
    }

    if (data.fonte === "RAG") {
      badge = "📚 <em>Baseado em documento institucional</em><br><br>";
    }

    if (data.fonte === "IA") {
      badge = "🤖 <em>Resposta assistida por IA</em><br><br>";
    }

    chatBox.innerHTML += `
      <div class="message bot">
        ${badge}
        ${resposta}
      </div>
    `;

    falar(resposta);

  } catch (error) {

    chatBox.removeChild(typing);

    const erroMsg =
      "⚠️ Ocorreu uma instabilidade na comunicação com o servidor.";

    chatBox.innerHTML += `<div class="message bot">${erroMsg}</div>`;

    falar(erroMsg);
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}


/* =====================================================
   ENTER PARA ENVIAR
===================================================== */

document.getElementById("user-input").addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    sendMessage();
  }
});
