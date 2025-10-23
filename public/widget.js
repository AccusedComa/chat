(function(){
  const CHAT_URL = "https://chat.mastersrelogios.com.br"; // muda se usar outro domínio

  // Estilos gerais
  const style = document.createElement("style");
  style.textContent = `
    #bhsWidgetButton {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background-color: #25D366;
      box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 9999;
    }
    #bhsWidgetButton img {
      width: 34px;
      height: 34px;
    }
    #bhsBadge {
      position: absolute;
      top: 8px;
      right: 8px;
      background: #ff3b30;
      color: #fff;
      font-size: 12px;
      font-weight: bold;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pulse 1.6s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: .7; }
      100% { transform: scale(1); opacity: 1; }
    }
    #bhsIframe {
      position: fixed;
      bottom: 100px;
      right: 24px;
      width: 400px;
      height: 560px;
      border: none;
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.3);
      z-index: 9998;
      display: none;
    }
    @media(max-width:600px){
      #bhsIframe {
        width: 92%;
        right: 4%;
        height: 80%;
        bottom: 90px;
      }
    }
  `;
  document.head.appendChild(style);

  // Botão
  const button = document.createElement("div");
  button.id = "bhsWidgetButton";
  button.innerHTML = `
    <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="Chat"/>
    <div id="bhsBadge">1</div>
  `;
  document.body.appendChild(button);

  // Iframe
  const iframe = document.createElement("iframe");
  iframe.id = "bhsIframe";
  iframe.src = CHAT_URL;
  document.body.appendChild(iframe);

  // Toggle abrir/fechar
  let open = false;
  button.addEventListener("click", ()=>{
    open = !open;
    iframe.style.display = open ? "block" : "none";
    const badge = document.getElementById("bhsBadge");
    if(badge) badge.style.display = open ? "none" : "flex";
  });
})();
