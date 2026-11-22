(() => {
  "use strict";
  const TOPIC = "kxko-m11-control-v1";
  const $ = id => document.getElementById(id);
  let channel = null, channelReady = false, online = false, connecting = false;
  const pending = new Map(), history = [];
  let historyIndex = 0, lastHeartbeat = 0, watchdog = null;

  function connection(state,label) {
    const pill=$("m11-connection-pill"), text=$("m11-connection-label");
    if(pill) pill.className="server-connection-pill "+(state==="online"?"is-online":state==="offline"?"is-offline":"");
    if(text) text.textContent=label;
    const live=$("m11-live-label");
    if(live){live.textContent=state==="online"?"LIVE":state==="offline"?"OFFLINE":"WAITING";live.classList.toggle("is-live",state==="online");}
    if($("m11-terminal-input")) $("m11-terminal-input").disabled=!online;
    if($("m11-terminal-run")) $("m11-terminal-run").disabled=!online;
    if($("m11-terminal-hint")) $("m11-terminal-hint").textContent=online?"Connected · commands run on the Samsung M11.":"Connect the M11 agent to enable commands.";
  }
  function writeOutput(value,isError=false,prompt=null){
    const box=$("m11-terminal-output"); if(!box)return;
    const row=document.createElement("div");row.className="server-terminal-line"+(isError?" is-error":"");
    if(prompt!==null){const p=document.createElement("span");p.className="prompt";p.textContent="m11 › "+prompt+"\n";row.append(p);}
    const out=document.createElement("span");out.className="response";out.textContent=String(value??"");row.append(out);box.append(row);box.scrollTop=box.scrollHeight;
    while(box.children.length>100)box.firstElementChild.remove();
  }
  function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2);}
  function send(action,args={},timeout=15000){
    if(!channelReady||!channel)return Promise.reject(new Error("The secure channel is not ready."));
    const requestId=id();
    return new Promise(async(resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error("The M11 did not respond in time."));},timeout);
      pending.set(requestId,{resolve,reject,timer});
      try{const result=await channel.send({type:"broadcast",event:"command",payload:{id:requestId,action,args,sentAt:new Date().toISOString()}});if(result!=="ok")throw new Error("Could not send command: "+result);}
      catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}
    });
  }
  function heartbeat(data={}){
    const firstConnection=!online;online=true;lastHeartbeat=Date.now();connection("online","M11 online");
    if(firstConnection&&channelReady){setTimeout(()=>{refreshProcesses().catch(()=>{});refreshProjects().catch(()=>{});},250);}
    if($("m11-device-name"))$("m11-device-name").textContent=data.device||"Kxko M11";
    if($("m11-device-meta"))$("m11-device-meta").textContent=[data.platform,data.model,data.node].filter(Boolean).join(" · ")||"Android · Termux";
    if($("m11-last-seen"))$("m11-last-seen").textContent="Just now";
    if($("m11-uptime"))$("m11-uptime").textContent=data.uptimeText||"Online";
    if($("m11-system-detail"))$("m11-system-detail").textContent=[data.node||"Node.js","Termux"].join(" · ");
    if(Number.isFinite(data.ramPercent)){
      if($("m11-memory"))$("m11-memory").textContent=data.ramPercent+"%";
      if($("m11-memory-bar"))$("m11-memory-bar").style.width=Math.max(0,Math.min(100,data.ramPercent))+"%";
      if($("m11-memory-detail"))$("m11-memory-detail").textContent=(data.ramUsed||"—")+" used of "+(data.ramTotal||"—");
    }
  }
  function renderList(targetId,items,kind){
    const host=$(targetId);if(!host)return;host.replaceChildren();
    if(!Array.isArray(items)||!items.length){host.className=kind+" server-empty";host.textContent=kind==="server-process-list"?"No PM2 processes found.":"No cloned projects found.";return;}
    host.className=kind;
    items.forEach(item=>{
      const row=document.createElement("div");row.className=kind==="server-process-list"?"server-process-row":"server-project-row";
      const copy=document.createElement("div");copy.className="server-row-copy";
      const name=document.createElement("strong");name.textContent=item.name||"Unnamed";
      const meta=document.createElement("small");meta.textContent=kind==="server-process-list"?"PID "+(item.pid??"—")+" · "+(item.memory||"—")+" · "+(item.restarts??0)+" restarts":(item.branch||"not a git checkout")+" · "+(item.clean?"clean":item.dirty?"changes":"—");
      const state=document.createElement("span");state.className="server-state"+(item.status&&item.status!=="online"?" is-stopped":"");state.textContent=kind==="server-process-list"?(item.status||"unknown"):(item.cloned?"CLONED":"MISSING");
      copy.append(name,meta);row.append(copy,state);
      if(kind==="server-process-list"){
        const button=document.createElement("button");button.type="button";button.className="server-row-action";button.textContent="Restart";
        button.addEventListener("click",async()=>{button.disabled=true;try{const r=await send("pm2_restart",{name:item.name});writeOutput(r.output||"Restart requested.");await refreshProcesses();}catch(e){writeOutput(e.message,true);}finally{button.disabled=false;}});
        row.append(button);
      }
      host.append(row);
    });
  }
  async function refreshProcesses(){const r=await send("processes");renderList("m11-process-list",r.data,"server-process-list");}
  async function refreshProjects(){const r=await send("projects");renderList("m11-project-list",r.data,"server-project-list");}
  function receive(payload={}){
    if(payload.heartbeat)heartbeat(payload.heartbeat);
    const item=pending.get(payload.id);
    if(item){clearTimeout(item.timer);pending.delete(payload.id);item.resolve(payload);}
    if(payload.action==="processes")renderList("m11-process-list",payload.data,"server-process-list");
    if(payload.action==="projects")renderList("m11-project-list",payload.data,"server-project-list");
  }
  async function connect(){
    if(connecting||channel)return;connecting=true;connection("waiting","Connecting…");
    try{
      const session=await db.auth.getSession();
      if(!session.data?.session)throw new Error("Sign in to the admin dashboard first.");
      channel=db.channel(TOPIC,{config:{private:true}});
      channel.on("broadcast",{event:"heartbeat"},({payload})=>heartbeat(payload||{}));
      channel.on("broadcast",{event:"result"},({payload})=>receive(payload||{}));
      channel.subscribe(status=>{
        if(status==="SUBSCRIBED"){
          channelReady=true;connection("waiting","Channel ready · waiting for M11");
          send("ping",{},8000).catch(()=>{});
        }else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status)){
          channelReady=false;online=false;connection("offline","Connection unavailable");
        }
      });
    }catch(error){connection("offline","Not connected");writeOutput(error.message,true);}
    finally{connecting=false;}
  }
  window.loadServerManager=async function(){
    await connect();
    if(watchdog)clearInterval(watchdog);
    watchdog=setInterval(()=>{if(lastHeartbeat&&Date.now()-lastHeartbeat>35000){online=false;connection("offline","M11 offline");}},5000);
    if(online){try{const r=await send("status");if(r.heartbeat)heartbeat(r.heartbeat);await refreshProcesses();await refreshProjects();}catch(e){writeOutput(e.message,true);}}
  };
  document.addEventListener("click",event=>{
    const action=event.target.closest("[data-server-action]");
    if(action){send(action.dataset.serverAction).then(r=>{if(r.heartbeat)heartbeat(r.heartbeat);if(r.output)writeOutput(r.output);}).catch(e=>writeOutput(e.message,true));return;}
    const chip=event.target.closest("[data-server-command]");
    if(chip&&$("m11-terminal-input")){$("m11-terminal-input").value=chip.dataset.serverCommand;$("m11-terminal-input").focus();}
  });
  $("m11-terminal-form")?.addEventListener("submit",async event=>{
    event.preventDefault();const input=$("m11-terminal-input"),line=input?.value.trim();if(!line)return;
    history.push(line);historyIndex=history.length;writeOutput("",false,line);input.value="";
    try{const r=await send("terminal",{line},30000);writeOutput(r.output||"Done.",!!r.error);}catch(e){writeOutput(e.message,true);}
  });
  $("m11-terminal-input")?.addEventListener("keydown",event=>{
    if(event.key==="ArrowUp"){event.preventDefault();historyIndex=Math.max(0,historyIndex-1);event.currentTarget.value=history[historyIndex]||"";}
    if(event.key==="ArrowDown"){event.preventDefault();historyIndex=Math.min(history.length,historyIndex+1);event.currentTarget.value=history[historyIndex]||"";}
  });
  $("m11-clear-terminal")?.addEventListener("click",()=>$("m11-terminal-output")?.replaceChildren());
  window.addEventListener("beforeunload",()=>{if(channel)db.removeChannel(channel);});
})();