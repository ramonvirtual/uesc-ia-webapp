window.onload = verificarAuth;

async function verificarAuth(){

  const res = await fetch("/verificar-auth", {
    credentials:"include"
  });

  if(!res.ok){
    window.location.href = "/login.html";
  }else{
    carregarDuvidas();
  }
}

async function carregarDuvidas(){

  const res = await fetch("/admin/duvidas", {
    credentials:"include"
  });

  const dados = await res.json();
  const container = document.getElementById("duvidasList");

  container.innerHTML = "";

  if(!dados.length){
    container.innerHTML = "<p>Nenhuma dúvida registrada.</p>";
    return;
  }

  dados.forEach(d => {

    const div = document.createElement("div");
    div.className = "duvida-item";

    div.innerHTML = `
      <h3>${d.nome} (${d.matricula})</h3>
      <p><strong>Email:</strong> ${d.email}</p>
      <p><strong>Dúvida:</strong> ${d.pergunta}</p>
      <div class="duvida-actions">
        <button class="delete-btn" onclick="excluir(${d.id})">Excluir</button>
      </div>
    `;

    container.appendChild(div);
  });
}

async function excluir(id){

  if(!confirm("Deseja excluir esta dúvida?")) return;

  await fetch(`/admin/duvidas/${id}`,{
    method:"DELETE",
    credentials:"include"
  });

  carregarDuvidas();
}

function logout(){
  fetch("/logout", { credentials:"include" })
    .then(()=>window.location.href="/login.html");
}
