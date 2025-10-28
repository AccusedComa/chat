(()=> {
  const API = (window.BHS_WIDGET_CONFIG?.API_BASE || "").replace(/\/$/,"");

  async function track(type, body={}) {
    try { await fetch(`${API}/api/track/${type}`, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify(body)
    }); } catch(e){}
  }

  const btn = document.createElement("button");
  btn.innerHTML = "💬";
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;width:60px;height:60px;border:none;border-radius:50%;background:#25D366;color:#fff;font-size:26px;cursor:pointer;z-index:9999";
  document.body.appendChild(btn);

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:20px;bottom:100px;width:320px;max-width:90vw;height:450px;background:#fff;border-radius:14px;box-shadow:0 0 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;z-index:9998";
  box.innerHTML = `
    <div style="background:#075E54;color:#fff;padding:10px;font-weight:bold">BHS Eletrônica</div>
    <div id="msgs" style="flex:1;overflow:auto;padding:10px;background:#f7f7f7"></div>
    <div style="display:flex;border-top:1px solid #ccc">
      <input id="msg" placeholder="Digite..." style="flex:1;padding:10px;border:none;outline:none">
      <button id="send" style="background:#25D366;color:#fff;border:none;padding:0 15px;cursor:pointer">▶</button>
    </div>`;
  document.body.appendChild(box);

  const msgs = box.querySelector("#msgs");
  const input = box.querySelector("#msg");
  const send = box.querySelector("#send");

  function addMsg(text, who="bot") {
    const d = document.createElement("div");
    d.style = `margin:6px 0;padding:8px 12px;border-radius:10px;max-width:80%;${who==="user"?"background:#DCF8C6;margin-left:auto":"background:#fff"}`;
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function sendMsg(txt) {
    if(!txt.trim()) return;
    addMsg(txt,"user");
    input.value="";
    track("message",{message:txt});
    const r = await fetch(`${API}/api/chat`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:txt,sessionId:"site"})
    });
    const data = await r.json();
    addMsg(data.message||"Sem resposta");
    track("ai",{message:data.message});
  }

  btn.onclick = ()=> {
    const s = box.style.display==="flex";
    box.style.display = s?"none":"flex";
    if(!s) track("open");
  };
  send.onclick = ()=>sendMsg(input.value);
  input.onkeypress = e=>{ if(e.key==="Enter") sendMsg(input.value); };

  // inicializa departamentos
  track("init");
})();
