document.addEventListener("DOMContentLoaded", () => {
  const chatButton = document.getElementById("chat-button");
  const chatContainer = document.getElementById("chat-container");
  const closeChat = document.getElementById("close-chat");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("send-btn");
  const chatBox = document.getElementById("chat-box");
  const badge = document.querySelector(".notification-badge");

  let sessionId = Date.now().toString();
  let processing = false;

  function addMessage(role, text) {
    const msg = document.createElement("div");
    msg.className = `msg ${role}`;
    msg.innerHTML = text;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function sendMessage(msg) {
    if (!msg || processing) return;
    processing = true;
    addMessage("user", msg);
    input.value = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, sessionId })
      });

      const data = await res.json();

      if (data.replies) {
        data.replies.forEach(r => addMessage("bot", r));
      } else if (data.reply) {
        addMessage("bot", data.reply);
      }

      if (data.options && data.options.items) showMenu(data.options.items);
      if (data.jumpTo) {
        window.open(data.jumpTo, "_blank");
        addMessage("bot", "🔙 Você pode continuar por aqui se quiser falar com outro setor.");
      }

    } catch (err) {
      console.error("Erro:", err);
      addMessage("bot", "⚠️ Tivemos uma falha na conexão com o servidor.");
    } finally {
      processing = false;
    }
  }

  function showMenu(items) {
    const menu = document.createElement("div");
    menu.className = "menu";

    items.forEach(item => {
      if (item.id === "ai") {
        const btn = document.createElement("button");
        btn.className = "btn-ai";
        btn.textContent = item.label;
        btn.onclick = () => sendMessage("/choose:ai");
        menu.appendChild(btn);
      } else if (item.id === "human" && item.subitems) {
        const title = document.createElement("div");
        title.className = "menu-title";
        title.textContent = item.label;
        menu.appendChild(title);

        item.subitems.forEach(sub => {
          const b = document.createElement("button");
          b.className = "btn-dept";
          b.textContent = `${sub.emoji || "💬"} ${sub.name}`;
          b.onclick = () => sendMessage(`/choose:dept_${sub.id}`);
          menu.appendChild(b);
        });
      }
    });

    chatBox.appendChild(menu);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  send.addEventListener("click", () => sendMessage(input.value.trim()));
  input.addEventListener("keypress", e => e.key === "Enter" && sendMessage(input.value.trim()));

  chatButton.addEventListener("click", () => {
    chatContainer.classList.toggle("hidden");
    badge.style.display = "none";
  });

  closeChat.addEventListener("click", () => {
    chatContainer.classList.add("hidden");
  });

  addMessage("bot", "Olá, sou Isa, a assistente virtual da BHS Eletrônica. Pra começar, me diga seu nome 👇");
});
