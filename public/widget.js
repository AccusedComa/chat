(() => {
  const CHAT_URL = ""; // deixe vazio para usar o mesmo domínio

  const api = (path, opts = {}) =>
    fetch((CHAT_URL || "") + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    }).then((r) => r.json());

  // ========== ELEMENTOS ==========
  const btn = document.createElement("div");
  btn.style.cssText =
    "position:fixed;right:18px;bottom:18px;z-index:99999;width:60px;height:60px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.2)";
  btn.innerHTML = `<img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="Chat" style="width:34px;height:34px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.2))">`;
  document.body.appendChild(btn);

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:18px;bottom:90px;width:340px;max-width:92vw;height:480px;max-height:75vh;background:#fff;border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.22);overflow:hidden;display:none;z-index:99998";
  panel.innerHTML = `
  <div style="background:#075E54;color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px">
    <div style="font-weight:600">BHS Eletrônica</div>
    <div style="margin-left:auto;font-size:12px;opacity:.9">Bela • Assistente</div>
  </div>
  <div id="bhs-messages" style="padding:12px;height:calc(100% - 120px);overflow:auto;background:#f7f8f9">
    <div class="msg bot">Olá 👋<br/>Escolha uma opção abaixo ou escreva sua dúvida.</div>
    <div id="bhs-deps" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px"></div>
  </div>
  <div style="border-top:1px solid #eee;padding:8px;display:flex;gap:8px;align-items:center">
    <input id="bhs-input" placeholder="Escreva aqui..." style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:10px;outline:none"/>
    <button id="bhs-send" style="background:#25D366;color:#fff;border:none;border-radius:10px;padding:10px 14px;cursor:pointer">Enviar</button>
  </div>
  <style>
    .msg{background:#fff;border-radius:12px;padding:10px 12px;margin:6px 0;max-width:85%;box-shadow:0 2px 10px rgba(0,0,0,.06)}
    .msg.bot{background:#E8F5E9}
    .msg.user{background:#DCF8C6;margin-left:auto}
    .typing{font-size:13px;color:#777;margin:6px 2px}
  </style>`;
  document.body.appendChild(panel);

  const $msgs = panel.querySelector("#bhs-messages");
  const $deps = panel.querySelector("#bhs-deps");
  const $input = panel.querySelector("#bhs-input");
  const $send = panel.querySelector("#bhs-send");

  let sessionId = Math.random().toString(36).slice(2);
  let hasChatted = false;

  // ======== HELPERS ========
  function addMsg(text, who = "bot") {
    const d = document.createElement("div");
    d.className = "msg " + who;
    d.innerHTML = text.replace(/\n/g, "<br/>");
    $msgs.appendChild(d);
    $msgs.scrollTop = $msgs.scrollHeight;
  }

  function showTyping(show = true) {
    let t = $msgs.querySelector(".typing");
    if (show) {
      if (!t) {
        t = document.createElement("div");
        t.className = "typing";
        t.textContent = "Bela está digitando…";
        $msgs.appendChild(t);
      }
    } else if (t) {
      t.remove();
    }
    $msgs.scrollTop = $msgs.scrollHeight;
  }

  async function trackEvent(event) {
    try {
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });
    } catch (err) {
      console.warn("Falha ao gravar estatística:", err);
    }
  }

  // ======== DEPARTAMENTOS ========
  async function loadDepartments() {
    const deps = await api("/api/departments");
    $deps.innerHTML = deps
      .map(
        (d) => `
      <button class="dep" data-id="${d.id}" data-name="${d.name}" data-type="${d.type}" data-phone="${d.phone || ""}">
        ${d.emoji || "💬"} ${d.name}
      </button>`
      )
      .join("");

    $deps.querySelectorAll(".dep").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        const type = btn.dataset.type;
        const phone = btn.dataset.phone;
        trackEvent(`botao_${name}`);

        addMsg(`Quero falar com ${name}`, "user");
        if (type === "whatsapp" && phone) {
          const url = `https://wa.me/${phone}`;
          window.open(url, "_blank");
          trackEvent("link_whatsapp");
        } else {
          sendMessage(`Quero falar com ${name}`);
        }
      });
    });
  }

  // ======== MENSAGENS ========
  async function sendMessage(text) {
    if (!hasChatted) {
      $deps.style.display = "none";
      hasChatted = true;
    }
    addMsg(text, "user");
    showTyping(true);

    try {
      const res = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, sessionId }),
      });

      setTimeout(() => {
        showTyping(false);
        addMsg(res.message || "Sem resposta agora.");
        if (res.showDepartments) $deps.style.display = "grid";
        trackEvent("mensagem_resposta");
      }, 800 + Math.random() * 400);
    } catch (e) {
      showTyping(false);
      addMsg("Erro ao enviar mensagem. Tente novamente.", "bot");
    }
  }

  // ======== EVENTOS GERAIS ========
  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "block" ? "none" : "block";
    trackEvent("chat_aberto");
    if (!$deps.children.length) loadDepartments();
  });

  $send.addEventListener("click", async () => {
    const msg = $input.value.trim();
    if (!msg) return;
    $input.value = "";
    trackEvent("mensagem_enviada");
    sendMessage(msg);
  });

  $input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") $send.click();
  });

  // Inicializa
  loadDepartments();
})();
