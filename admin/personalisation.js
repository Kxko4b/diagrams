/* Kxko Briefing personal accounts. Admin access remains on the existing allow-list. */
(() => {
  "use strict";
  const MODULES = window.KxkoFeatureRegistry || [];  const $ = (id) => document.getElementById(id);
  const isAdmin = (user) => user?.email?.toLowerCase() === "haleannson@gmail.com";
  let currentUser = null, prefs = {}, profile = {}, enabled = new Set(), step = 0;

  function installAdminTheme(){
    const header=document.querySelector("#app .dashboard-header");if(!header||$("admin-theme-toggle"))return;
    const button=document.createElement("button");button.id="admin-theme-toggle";button.className="personal-theme-toggle";button.type="button";
    const apply=()=>{const light=localStorage.getItem("kxko-admin-theme")==="light";document.documentElement.dataset.kxTheme=light?"light":"dark";button.textContent=light?"☾ Dark mode":"☼ Light mode";};
    button.addEventListener("click",()=>{localStorage.setItem("kxko-admin-theme",document.documentElement.dataset.kxTheme==="light"?"dark":"light");apply();});
    header.append(button);apply();
  }
  function addAuthControls() {
    const box = document.querySelector(".login-box");
    if (!box || $("personal-signup")) return;
    const name = document.createElement("input");
    name.id = "personal-name"; name.type = "text"; name.placeholder = "Your name (for new accounts)";
    name.autocomplete = "name"; name.maxLength = 80;
    const actions = document.createElement("div");
    actions.className = "personal-auth-actions";
    actions.innerHTML = '<button id="personal-signup" class="secondary" type="button">Create personal account</button><button id="personal-reset" class="text-button" type="button">Forgot password?</button>';
    $("admin-password")?.insertAdjacentElement("afterend", name);
    $("login-button")?.insertAdjacentElement("afterend", actions);
    $("login-button").textContent = "Sign in";
    $("login-button").addEventListener("click", async (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      const email = $("admin-email").value.trim(), password = $("admin-password").value;
      setAuthMessage("");
      if (!email || !password) return setAuthMessage("Enter your email and password.");
      const button = $("login-button"); button.disabled = true; button.textContent = "Signing in…";
      const {data,error} = await db.auth.signInWithPassword({email,password});
      button.disabled = false; button.textContent = "Sign in";
      if (error) return setAuthMessage(error.message);
      if (isAdmin(data.user)) return location.reload();
      await openPersonalApp(data.user);
    }, true);
    $("personal-signup").addEventListener("click", async () => {
      const email = $("admin-email").value.trim(), password = $("admin-password").value, full_name = $("personal-name").value.trim();
      setAuthMessage("");
      if (!full_name) return setAuthMessage("Please enter the name you'd like the app to use.");
      if (!email || password.length < 8) return setAuthMessage("Enter an email and a password with at least 8 characters.");
      const button = $("personal-signup"); button.disabled = true; button.textContent = "Creating account…";
      const {data,error} = await db.auth.signUp({email,password,options:{data:{full_name}}});
      button.disabled = false; button.textContent = "Create personal account";
      if (error) return setAuthMessage(error.message);
      if (!data.session) return setAuthMessage("Account created. Check your email to confirm it, then sign in.");
      await openPersonalApp(data.user);
    });
    $("personal-reset").addEventListener("click", async () => {
      const email = $("admin-email").value.trim();
      if (!email) return setAuthMessage("Enter your email address first.");
      const {error} = await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
      setAuthMessage(error ? error.message : "If an account exists for that address, a password reset email is on its way.");
    });
  }
  function setAuthMessage(message) { const el=$("error"); if(el) el.textContent=message; }
  function ensurePortal() {
    if ($("personal-app")) return;
    const root=document.createElement("main"); root.id="personal-app"; root.className="personal-app hidden";
    root.innerHTML=`
      <header class="personal-topbar"><a class="personal-brand" href="#"><span class="personal-mark">K</span><span>Kxko <small>BRIEFING</small></span></a><div class="personal-top-actions"><span id="personal-email"></span><button id="personal-signout" class="text-button">Sign out</button></div></header>
      <section class="personal-shell"><aside class="personal-rail"><span class="personal-eyebrow">YOUR SPACE</span><button class="personal-tab active" data-panel="home">Overview</button><button class="personal-tab" data-panel="setup">Setup</button><button class="personal-tab" data-panel="features">Features</button><button class="personal-tab" data-panel="settings">Settings</button><button class="personal-tab" data-panel="account">My account</button></aside>
      <div class="personal-content"><section id="personal-home" class="personal-panel"><p class="personal-eyebrow">YOUR PERSONAL BRIEFING</p><h1 id="personal-greeting">Welcome</h1><p class="personal-lead">A calmer overview of the things that matter to your day.</p><div class="personal-summary-grid"><article class="personal-card personal-welcome-card"><span class="personal-eyebrow">GETTING STARTED</span><h2 id="personal-setup-title">Make this space yours</h2><p id="personal-setup-copy">Choose your modules and preferences. External accounts are always optional.</p><button class="personal-primary" data-go="setup">Continue setup <span>→</span></button></article><article class="personal-card"><span class="personal-eyebrow">YOUR MODULES</span><div id="personal-module-summary" class="personal-module-summary"></div></article></div></section>
      <section id="personal-setup" class="personal-panel hidden"><p class="personal-eyebrow">PERSONAL SETUP · <span id="setup-step-label">01 / 08</span></p><div class="setup-progress"><span id="setup-progress-fill"></span></div><h1 id="setup-title">Welcome</h1><p id="setup-description" class="personal-lead"></p><div id="setup-fields" class="setup-fields"></div><div class="setup-actions"><button id="setup-back" class="personal-secondary">Back</button><button id="setup-skip" class="text-button">Skip for now</button><button id="setup-next" class="personal-primary">Continue →</button></div></section>
      <section id="personal-features" class="personal-panel hidden"><p class="personal-eyebrow">MAKE IT YOURS</p><h1>Your features</h1><p class="personal-lead">Switch modules on or off whenever you like. Turning one off hides it; it does not erase its data.</p><div id="personal-feature-list" class="personal-feature-list"></div><button id="save-features" class="personal-primary">Save features</button><p id="feature-status" class="personal-status" role="status"></p></section>
      <section id="personal-settings" class="personal-panel hidden"><p class="personal-eyebrow">PREFERENCES</p><h1>Settings</h1><div class="personal-card settings-card"><label>Display name<input id="setting-name" maxlength="80"></label><label>Theme<select id="setting-theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label><label>Accent colour<select id="setting-accent"><option value="amber">Warm amber</option><option value="terracotta">Terracotta</option><option value="sage">Sage green</option><option value="violet">Soft violet</option></select></label><label>Weather location<input id="setting-location" maxlength="100" placeholder="Town or city"></label><label>Layout density<select id="setting-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button id="save-settings" class="personal-primary">Save preferences</button><p id="settings-status" class="personal-status" role="status"></p></div></section>
      <section id="personal-account" class="personal-panel hidden"><p class="personal-eyebrow">ACCOUNT & PRIVACY</p><h1>My account</h1><div class="personal-card settings-card"><p id="account-email"></p><p>Your account preferences are stored against your Supabase user ID and protected by row-level security.</p><button id="delete-account" class="personal-danger">Delete my account</button><p id="account-status" class="personal-status" role="status"></p></div></section></div></section>`;
    document.body.append(root);
    root.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.panel)));
    root.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.go)));
    $("personal-signout").addEventListener("click",async()=>{await db.auth.signOut();location.reload();});
    $("setup-back").addEventListener("click",()=>renderStep(Math.max(0,step-1)));
    $("setup-next").addEventListener("click",()=>{captureStep(step);step===7?finishSetup():renderStep(Math.min(7,step+1));});
    $("setup-skip").addEventListener("click",finishSetup);
    $("save-features").addEventListener("click",saveFeatures);
    $("save-settings").addEventListener("click",saveSettings);
    $("delete-account").addEventListener("click",deleteAccount);
  }
  function showPanel(name) {
    document.querySelectorAll(".personal-panel").forEach(p=>p.classList.toggle("hidden",p.id!=="personal-"+name));
    document.querySelectorAll(".personal-tab").forEach(b=>b.classList.toggle("active",b.dataset.panel===name));
    if(name==="setup")renderStep(step);
  }
  async function openPersonalApp(user) {
    currentUser=user; ensurePortal();
    $("login").classList.add("hidden"); $("app")?.classList.add("hidden"); $("personal-app").classList.remove("hidden");
    $("personal-email").textContent=user.email||""; $("account-email").textContent=user.email||"";
    const [pr,pe,mo]=await Promise.all([
      db.from("user_profiles").select("*").eq("user_id",user.id).maybeSingle(),
      db.from("user_preferences").select("*").eq("user_id",user.id).maybeSingle(),
      db.from("user_modules").select("*").eq("user_id",user.id)
    ]);
    if(pr.error||pe.error||mo.error){console.error(pr.error||pe.error||mo.error);$("personal-greeting").textContent="Your account is ready";$("personal-setup-copy").textContent="Your profile tables need the supplied Supabase migration before preferences can sync.";return;}
    profile=pr.data||{}; prefs=pe.data?.preferences||{}; enabled=new Set((mo.data||[]).filter(x=>x.enabled).map(x=>x.module_key));
    $("personal-greeting").textContent="Welcome"+(profile.display_name?" back, "+profile.display_name:"");
    $("personal-setup-title").textContent=profile.onboarding_completed?"Your space is ready":"Let's set things up";
    $("personal-setup-copy").textContent=profile.onboarding_completed?"Your preferences are saved. You can change them at any time.":"A few quick choices will make your briefing feel like yours.";
    $("setting-name").value=profile.display_name||user.user_metadata?.full_name||"";
    $("setting-theme").value=prefs.theme||"dark"; $("setting-accent").value=prefs.accent||"amber"; $("setting-location").value=prefs.location||"Buseck"; $("setting-density").value=prefs.density||"comfortable";
    applyTheme(); renderFeatureList(); renderModuleSummary(); showPanel("home");
    if(!profile.onboarding_completed){step=0;showPanel("setup");}
  }
  const steps=[
    ["Welcome","A personal home for your weather, school day, calendar and more.","<p>Set up the parts you want. You can skip integrations and come back whenever you like.</p>"],
    ["Your profile","What should we call you?","<label>Preferred name<input id='wizard-name' maxlength='80' placeholder='Your name'></label>"],
    ["Appearance","Choose a look that feels right.","<label>Theme<select id='wizard-theme'><option value='dark'>Dark</option><option value='light'>Light</option><option value='system'>Use device setting</option></select></label><label>Accent<select id='wizard-accent'><option value='amber'>Warm amber</option><option value='terracotta'>Terracotta</option><option value='sage'>Sage green</option><option value='violet'>Soft violet</option></select></label>"],
    ["Weather","Where should we look for your forecast?","<label>Location<input id='wizard-location' placeholder='Town or city' value='Buseck'></label><p>Weather alerts can be configured later. No location permission is required.</p>"],
    ["School / WebUntis","Connect your school account later from Integrations.","<p>WebUntis is optional. You can use the app without connecting it.</p>"],
    ["Calendar","Bring your schedule together when you're ready.","<p>Google Calendar connection is optional and can be completed later.</p>"],
    ["Daily Briefing","Choose the information you want in your daily summary.","<p>Start with weather and the briefing module. You can adjust sections and delivery schedules later.</p>"],
    ["Your modules","Enable the features you want to see.","<div id='wizard-modules'></div>"]
  ];
  function captureStep(n){
    if(n===1&&$("wizard-name"))profile.display_name=$("wizard-name").value.trim();
    if(n===2&&$("wizard-theme")){prefs.theme=$("wizard-theme").value;prefs.accent=$("wizard-accent").value;}
    if(n===3&&$("wizard-location"))prefs.location=$("wizard-location").value.trim()||"Buseck";
    if(n===7)$("wizard-modules")?.querySelectorAll("[data-module]").forEach(c=>c.checked?enabled.add(c.dataset.module):enabled.delete(c.dataset.module));
  }
  function renderStep(n){
    step=n;const s=steps[n];$("setup-step-label").textContent=String(n+1).padStart(2,"0")+" / 08";$("setup-progress-fill").style.width=((n+1)/8*100)+"%";$("setup-title").textContent=s[0];$("setup-description").textContent=s[1];$("setup-fields").innerHTML=s[2];$("setup-back").disabled=n===0;$("setup-next").textContent=n===7?"Finish setup →":"Continue →";
    if(n===1)$("wizard-name").value=profile.display_name||currentUser.user_metadata?.full_name||"";
    if(n===2){$("wizard-theme").value=prefs.theme||"dark";$("wizard-accent").value=prefs.accent||"amber";}
    if(n===3)$("wizard-location").value=prefs.location||"Buseck";
    if(n===7){$("wizard-modules").innerHTML=MODULES.filter(x=>x.id!=="business").map(x=>'<label class="personal-feature-row"><span><b>'+x.name+'</b><small>'+x.description+'</small></span><input type="checkbox" data-module="'+x.id+'" '+(enabled.has(x.id)?'checked':'')+'></label>').join("");}
  }
  async function finishSetup(){
    captureStep(step);
    const p=await db.from("user_profiles").upsert({user_id:currentUser.id,display_name:profile.display_name||"",onboarding_completed:true},{onConflict:"user_id"});
    const q=await db.from("user_preferences").upsert({user_id:currentUser.id,preferences:prefs},{onConflict:"user_id"});
    if(p.error||q.error){$("setup-description").textContent="Couldn't save your setup: "+(p.error||q.error).message;return;}
    await Promise.all(MODULES.map(x=>db.from("user_modules").upsert({user_id:currentUser.id,module_key:x.id,enabled:enabled.has(x.id)},{onConflict:"user_id,module_key"})));profile.onboarding_completed=true;$("personal-setup-title").textContent="You're all set";$("personal-setup-copy").textContent="Your personal space is ready. You can revisit setup and settings any time.";applyTheme();renderModuleSummary();showPanel("home");
  }
  function renderFeatureList(){
    $("personal-feature-list").innerHTML=MODULES.map(x=>'<label class="personal-feature-row"><span><b>'+x.name+'</b><small>'+x.description+'</small></span><input type="checkbox" data-module="'+x.id+'" '+(enabled.has(x.id)?'checked':'')+'></label>').join("");
  }
  function renderModuleSummary(){
    $("personal-module-summary").innerHTML=MODULES.filter(x=>enabled.has(x.id)).map(x=>'<span>'+x.name+'</span>').join("")||"<p>No modules enabled yet.</p>";
  }
  async function saveFeatures(showMessage=true){
    const rows=[...document.querySelectorAll("#personal-feature-list [data-module]")];
    rows.forEach(c=>c.checked?enabled.add(c.dataset.module):enabled.delete(c.dataset.module));
    const result=await Promise.all(MODULES.map(x=>db.from("user_modules").upsert({user_id:currentUser.id,module_key:x.id,enabled:enabled.has(x.id)},{onConflict:"user_id,module_key"})));
    const error=result.find(x=>x.error)?.error;
    $("feature-status").textContent=error?"Couldn't save: "+error.message:"Features saved. Disabled modules keep their data.";
    renderModuleSummary();if(showMessage)showPanel("features");
  }
  async function saveSettings(){
    profile.display_name=$("setting-name").value.trim();
    prefs={...prefs,theme:$("setting-theme").value,accent:$("setting-accent").value,location:$("setting-location").value.trim(),density:$("setting-density").value};
    const [a,b]=await Promise.all([
      db.from("user_profiles").upsert({user_id:currentUser.id,display_name:profile.display_name},{onConflict:"user_id"}),
      db.from("user_preferences").upsert({user_id:currentUser.id,preferences:prefs},{onConflict:"user_id"})
    ]);
    $("settings-status").textContent=a.error||b.error?"Couldn't save: "+(a.error||b.error).message:"Preferences saved to your account.";
    $("personal-greeting").textContent="Welcome"+(profile.display_name?", "+profile.display_name:"");applyTheme();
  }
  function applyTheme(){
    const root=$("personal-app");if(!root)return;
    root.dataset.theme=prefs.theme||"dark";root.dataset.accent=prefs.accent||"amber";
  }
  async function deleteAccount(){
    if(!confirm("Permanently delete your account and its personal settings? This cannot be undone."))return;
    const {data,error}=await db.functions.invoke("delete-account");
    if(error){$("account-status").textContent="Account deletion failed: "+error.message;return;}
    await db.auth.signOut();location.reload();
  }
  async function boot(){
    addAuthControls();ensurePortal();installAdminTheme();
    const {data}=await db.auth.getUser();
    if(data?.user&&!isAdmin(data.user))await openPersonalApp(data.user);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
