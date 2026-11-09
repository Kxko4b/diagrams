/* Kxko Briefing personal accounts. Admin access remains on the existing allow-list. */
(() => {
  "use strict";
  const MODULES = window.KxkoFeatureRegistry || [];
  const PERSONAL_MODULES = MODULES.filter(x => x.id !== "business");
  const $ = (id) => document.getElementById(id);
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
      <section class="personal-shell"><aside class="personal-rail"><span class="personal-eyebrow">YOUR SPACE</span><button class="personal-tab active" data-panel="home">Overview</button><button class="personal-tab" data-panel="setup">Setup</button><button class="personal-tab" data-panel="features">Features</button><button class="personal-tab" data-panel="connections">Connections</button><button class="personal-tab" data-panel="settings">Settings</button><button class="personal-tab" data-panel="account">My account</button></aside>
      <div class="personal-content"><section id="personal-home" class="personal-panel"><p class="personal-eyebrow">YOUR PERSONAL BRIEFING</p><h1 id="personal-greeting">Welcome</h1><p class="personal-lead">A calmer overview of the things that matter to your day.</p><div class="personal-summary-grid"><article class="personal-card personal-welcome-card"><span class="personal-eyebrow">GETTING STARTED</span><h2 id="personal-setup-title">Make this space yours</h2><p id="personal-setup-copy">Choose your modules and preferences. External accounts are always optional.</p><button class="personal-primary" data-go="setup">Continue setup <span>→</span></button></article><article class="personal-card"><span class="personal-eyebrow">YOUR MODULES</span><div id="personal-module-summary" class="personal-module-summary"></div></article><article class="personal-card personal-weather-card"><div class="personal-weather-head"><div><span class="personal-eyebrow">LOCAL FORECAST</span><h2 id="personal-weather-place">Weather</h2></div><button id="personal-weather-refresh" class="personal-secondary" type="button">Refresh</button></div><div id="personal-weather-content" aria-live="polite">Add a location in Settings to see your forecast.</div></article></div></section>
      <section id="personal-setup" class="personal-panel hidden"><p class="personal-eyebrow">PERSONAL SETUP · <span id="setup-step-label">01 / 08</span></p><div class="setup-progress"><span id="setup-progress-fill"></span></div><h1 id="setup-title">Welcome</h1><p id="setup-description" class="personal-lead"></p><div id="setup-fields" class="setup-fields"></div><div class="setup-actions"><button id="setup-back" class="personal-secondary">Back</button><button id="setup-skip" class="text-button">Skip for now</button><button id="setup-next" class="personal-primary">Continue →</button></div></section>
      <section id="personal-features" class="personal-panel hidden"><p class="personal-eyebrow">MAKE IT YOURS</p><h1>Your features</h1><p class="personal-lead">Switch modules on or off whenever you like. Turning one off hides it; it does not erase its data.</p><div id="personal-feature-list" class="personal-feature-list"></div><button id="save-features" class="personal-primary">Save features</button><p id="feature-status" class="personal-status" role="status"></p></section>
      <section id="personal-connections" class="personal-panel hidden"><p class="personal-eyebrow">ACCOUNTS & SERVICES</p><h1>Connections</h1><p class="personal-lead">Each service will be connected to your own account. Administrator credentials and calendars are never reused here.</p><div class="personal-connection-list"><article class="personal-card"><div><b>Weather</b><span class="personal-connection-state connected">Available</span></div><p>Uses the location saved in your preferences. No external account or password needed.</p></article><article class="personal-card"><div><b>WebUntis</b><span class="personal-connection-state pending">Coming soon</span></div><p>Personal school-account connection is not available yet. Your administrator's timetable stays private.</p></article><article class="personal-card"><div><b>Google Calendar</b><span class="personal-connection-state pending">Coming soon</span></div><p>A separate Google sign-in and private token storage are required before this can be enabled.</p></article><article class="personal-card"><div><b>Notifications</b><span class="personal-connection-state pending">Coming soon</span></div><p>Personal push delivery is not enabled yet. Existing administrator notifications remain separate.</p></article></div></section>
      <section id="personal-settings" class="personal-panel hidden"><p class="personal-eyebrow">PREFERENCES</p><h1>Settings</h1><div class="personal-card settings-card"><label>Display name<input id="setting-name" maxlength="80"></label><label>Theme<select id="setting-theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label><label>Accent colour<select id="setting-accent"><option value="amber">Warm amber</option><option value="terracotta">Terracotta</option><option value="sage">Sage green</option><option value="violet">Soft violet</option></select></label><label>Weather location<input id="setting-location" maxlength="100" placeholder="Town or city"></label><label>Layout density<select id="setting-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button id="save-settings" class="personal-primary">Save preferences</button><p id="settings-status" class="personal-status" role="status"></p></div></section>
      <section id="personal-account" class="personal-panel hidden"><p class="personal-eyebrow">ACCOUNT & PRIVACY</p><h1>My account</h1><div class="personal-card settings-card"><p id="account-email"></p><p>Your account preferences are stored against your Supabase user ID and protected by row-level security.</p><label>New password<input id="account-new-password" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label><button id="change-password" class="personal-secondary">Change password</button><p id="password-status" class="personal-status" role="status"></p><button id="delete-account" class="personal-danger">Delete my account</button><p id="account-status" class="personal-status" role="status"></p></div></section></div></section>`;
    document.body.append(root);
    root.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.panel)));
    root.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.go)));
    $("change-password").addEventListener("click",changePassword);
    $("personal-weather-refresh").addEventListener("click",loadPersonalWeather);
    installRecoveryPanel();
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
    profile=pr.data||{}; prefs=pe.data?.preferences||{}; enabled=new Set((mo.data||[]).filter(x=>x.enabled&&PERSONAL_MODULES.some(m=>m.id===x.module_key&&m.available!==false)).map(x=>x.module_key));
    $("personal-greeting").textContent="Welcome"+(profile.display_name?" back, "+profile.display_name:"");
    $("personal-setup-title").textContent=profile.onboarding_completed?"Your space is ready":"Let's set things up";
    $("personal-setup-copy").textContent=profile.onboarding_completed?"Your preferences are saved. You can change them at any time.":"A few quick choices will make your briefing feel like yours.";
    $("setting-name").value=profile.display_name||user.user_metadata?.full_name||"";
    $("setting-theme").value=prefs.theme||"dark"; $("setting-accent").value=prefs.accent||"amber"; $("setting-location").value=prefs.location||"Buseck"; $("setting-density").value=prefs.density||"comfortable";
    applyTheme(); renderFeatureList(); renderModuleSummary(); showPanel("home");
    loadPersonalWeather();
    if(!profile.onboarding_completed){step=0;showPanel("setup");}
  }
  const steps=[
    ["Welcome","A personal home for your weather, school day, calendar and more.","<p>Set up the parts you want. You can skip integrations and come back whenever you like.</p>"],
    ["Your profile","What should we call you?","<label>Preferred name<input id='wizard-name' maxlength='80' placeholder='Your name'></label>"],
    ["Appearance","Choose a look that feels right.","<label>Theme<select id='wizard-theme'><option value='dark'>Dark</option><option value='light'>Light</option><option value='system'>Use device setting</option></select></label><label>Accent<select id='wizard-accent'><option value='amber'>Warm amber</option><option value='terracotta'>Terracotta</option><option value='sage'>Sage green</option><option value='violet'>Soft violet</option></select></label>"],
    ["Weather","Where should we look for your forecast?","<label>Location<input id='wizard-location' placeholder='Town or city' value='Buseck'></label><p>Weather alerts can be configured later. No location permission is required.</p>"],
    ["School / WebUntis","Personal WebUntis access is not available yet.","<p>The existing administrator timetable is private and will not be shared with personal accounts. Do not enter your school password here.</p>"],
    ["Calendar","Personal Google Calendar connection is not available yet.","<p>The administrator calendar remains private. A separate, secure Google sign-in flow is required before personal accounts can connect.</p>"],
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
    if(n===7){$("wizard-modules").innerHTML=PERSONAL_MODULES.map(x=>'<label class="personal-feature-row"><span><b>'+x.name+'</b><small>'+x.description+(x.available===false?' · Coming soon':'')+'</small></span><input type="checkbox" data-module="'+x.id+'" '+(x.available===false?'disabled ':'')+(enabled.has(x.id)?'checked':'')+'></label>').join("");}
  }
  async function finishSetup(){
    captureStep(step);
    const p=await db.from("user_profiles").upsert({user_id:currentUser.id,display_name:profile.display_name||"",onboarding_completed:true},{onConflict:"user_id"});
    const q=await db.from("user_preferences").upsert({user_id:currentUser.id,preferences:prefs},{onConflict:"user_id"});
    if(p.error||q.error){$("setup-description").textContent="Couldn't save your setup: "+(p.error||q.error).message;return;}
    await Promise.all(PERSONAL_MODULES.map(x=>db.from("user_modules").upsert({user_id:currentUser.id,module_key:x.id,enabled:enabled.has(x.id)},{onConflict:"user_id,module_key"})));profile.onboarding_completed=true;$("personal-setup-title").textContent="You're all set";$("personal-setup-copy").textContent="Your personal space is ready. You can revisit setup and settings any time.";applyTheme();renderModuleSummary();showPanel("home");
  }
  function renderFeatureList(){
    $("personal-feature-list").innerHTML=PERSONAL_MODULES.map(x=>'<label class="personal-feature-row"><span><b>'+x.name+'</b><small>'+x.description+(x.available===false?' · Coming soon':'')+'</small></span><input type="checkbox" data-module="'+x.id+'" '+(x.available===false?'disabled ':'')+(enabled.has(x.id)?'checked':'')+'></label>').join("");
  }
  function renderModuleSummary(){
    $("personal-module-summary").innerHTML=PERSONAL_MODULES.filter(x=>x.available!==false&&enabled.has(x.id)).map(x=>'<span>'+x.name+'</span>').join("")||"<p>No modules enabled yet.</p>";
  }
  async function saveFeatures(showMessage=true){
    const rows=[...document.querySelectorAll("#personal-feature-list [data-module]")];
    rows.forEach(c=>c.checked?enabled.add(c.dataset.module):enabled.delete(c.dataset.module));
    const result=await Promise.all(PERSONAL_MODULES.map(x=>db.from("user_modules").upsert({user_id:currentUser.id,module_key:x.id,enabled:enabled.has(x.id)},{onConflict:"user_id,module_key"})));
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
    $("personal-greeting").textContent="Welcome"+(profile.display_name?", "+profile.display_name:"");applyTheme();loadPersonalWeather();
  }
  function applyTheme(){
    const root=$("personal-app");if(!root)return;
    root.dataset.theme=prefs.theme||"dark";root.dataset.accent=prefs.accent||"amber";if(root.dataset.theme==="system")root.dataset.theme=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";
  }
  function weatherDescription(code){
    if(code===0)return "Clear sky";
    if([1,2,3].includes(code))return "Partly cloudy";
    if([45,48].includes(code))return "Fog";
    if([51,53,55,56,57].includes(code))return "Drizzle";
    if([61,63,65,66,67,80,81,82].includes(code))return "Rain";
    if([71,73,75,77,85,86].includes(code))return "Snow";
    if([95,96,99].includes(code))return "Thunderstorms";
    return "Weather conditions";
  }
  async function loadPersonalWeather(){
    const panel=$("personal-weather-content");if(!panel)return;
    const locationName=prefs.location||"Buseck";
    $("personal-weather-place").textContent=locationName;
    if(!enabled.has("weather")){panel.textContent="Weather is switched off in Your features.";return;}
    panel.textContent="Loading forecast…";
    try{
      const geoResponse=await fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(locationName)+"&count=1&language=en&format=json");
      if(!geoResponse.ok)throw new Error("Location lookup failed.");
      const geo=await geoResponse.json(),place=geo.results?.[0];
      if(!place)throw new Error("We couldn't find that location. Check the spelling in Settings.");
      const url="https://api.open-meteo.com/v1/forecast?latitude="+place.latitude+"&longitude="+place.longitude+"&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3";
      const response=await fetch(url);if(!response.ok)throw new Error("Forecast service unavailable.");
      const data=await response.json(),now=data.current,days=data.daily;
      const rows=days.time.map((day,i)=>'<div class="personal-forecast-day"><span>'+new Date(day+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short"})+'</span><span>'+weatherDescription(days.weather_code[i])+'</span><b>'+Math.round(days.temperature_2m_max[i])+'° / '+Math.round(days.temperature_2m_min[i])+'°</b></div>').join("");
      $("personal-weather-place").textContent=place.name+(place.country?", "+place.country:"");
      panel.innerHTML='<div class="personal-weather-now"><strong>'+Math.round(now.temperature_2m)+'°</strong><div><b>'+weatherDescription(now.weather_code)+'</b><span>Feels like '+Math.round(now.apparent_temperature)+'° · '+Math.round(now.relative_humidity_2m)+'% humidity</span></div></div><div class="personal-weather-meta"><span>Wind '+Math.round(now.wind_speed_10m)+' km/h</span><span>Rain '+now.precipitation+' mm</span></div><div class="personal-forecast-list">'+rows+'</div><small class="personal-weather-source">Forecast by Open-Meteo</small>';
    }catch(error){panel.textContent=error.message||"Couldn't load the forecast.";}
  }
  async function changePassword(){
    const password=$("account-new-password").value;
    if(password.length<8){$("password-status").textContent="Use at least 8 characters.";return;}
    const button=$("change-password");button.disabled=true;button.textContent="Updating…";
    const {error}=await db.auth.updateUser({password});
    button.disabled=false;button.textContent="Change password";
    $("password-status").textContent=error?"Couldn't update password: "+error.message:"Password updated.";
    if(!error)$("account-new-password").value="";
  }
  function installRecoveryPanel(){
    if($("password-recovery-panel"))return;
    const panel=document.createElement("section");panel.id="password-recovery-panel";panel.className="password-recovery-panel hidden";
    panel.innerHTML='<div class="password-recovery-card"><p class="personal-eyebrow">ACCOUNT RECOVERY</p><h2>Choose a new password</h2><p>Enter a new password for your account.</p><label>New password<input id="recovery-password" type="password" minlength="8" autocomplete="new-password"></label><button id="recovery-save" class="personal-primary">Save new password</button><p id="recovery-status" role="status"></p></div>';
    document.body.append(panel);
    $("recovery-save").addEventListener("click",async()=>{
      const password=$("recovery-password").value;
      if(password.length<8){$("recovery-status").textContent="Use at least 8 characters.";return;}
      const button=$("recovery-save");button.disabled=true;button.textContent="Saving…";
      const {error}=await db.auth.updateUser({password});
      button.disabled=false;button.textContent="Save new password";
      $("recovery-status").textContent=error?"Couldn't update password: "+error.message:"Password changed. You can now sign in with it.";
      if(!error){await db.auth.signOut();setTimeout(()=>location.reload(),900);}
    });
  }
  async function deleteAccount(){
    if(!confirm("Permanently delete your account and its personal settings? This cannot be undone."))return;
    const {data,error}=await db.functions.invoke("delete-account");
    if(error){$("account-status").textContent="Account deletion failed: "+error.message;return;}
    await db.auth.signOut();location.reload();
  }
  async function boot(){
    addAuthControls();ensurePortal();installAdminTheme();installRecoveryPanel();
    db.auth.onAuthStateChange((event)=>{if(event==="PASSWORD_RECOVERY")$("password-recovery-panel")?.classList.remove("hidden");});
    const {data}=await db.auth.getUser();
    if(data?.user&&!isAdmin(data.user))await openPersonalApp(data.user);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
