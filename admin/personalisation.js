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
      <section class="personal-shell"><aside class="personal-rail"><span class="personal-eyebrow">YOUR SPACE</span><button class="personal-tab active" data-panel="home">Overview</button><button class="personal-tab" data-panel="homework">Homework</button><button class="personal-tab" data-panel="setup">Setup</button><button class="personal-tab" data-panel="features">Features</button><button class="personal-tab" data-panel="connections">Connections</button><button class="personal-tab" data-panel="settings">Settings</button><button class="personal-tab" data-panel="account">My account</button></aside>
      <div class="personal-content"><section id="personal-home" class="personal-panel"><p class="personal-eyebrow">YOUR PERSONAL BRIEFING</p><h1 id="personal-greeting">Welcome</h1><p class="personal-lead">A calmer overview of the things that matter to your day.</p><div class="personal-summary-grid"><article class="personal-card personal-briefing-card"><div class="personal-weather-head"><div><span class="personal-eyebrow">TODAY AT A GLANCE</span><h2>Your daily overview</h2></div><button id="personal-briefing-refresh" class="personal-secondary" type="button">Refresh</button></div><div id="personal-briefing-content" aria-live="polite">Your personal overview will appear here.</div></article><article class="personal-card personal-homework-summary-card"><span class="personal-eyebrow">SCHOOL · PERSONAL TASKS</span><h2>Homework</h2><div id="personal-homework-summary" class="personal-homework-summary">Your tasks will appear here.</div><button class="personal-secondary" data-go="homework" type="button">Manage homework →</button></article><article class="personal-card personal-welcome-card"><span class="personal-eyebrow">GETTING STARTED</span><h2 id="personal-setup-title">Make this space yours</h2><p id="personal-setup-copy">Choose your modules and preferences. External accounts are always optional.</p><button class="personal-primary" data-go="setup">Continue setup <span>→</span></button></article><article class="personal-card"><span class="personal-eyebrow">YOUR MODULES</span><div id="personal-module-summary" class="personal-module-summary"></div></article><article class="personal-card personal-weather-card"><div class="personal-weather-head"><div><span class="personal-eyebrow">LOCAL FORECAST</span><h2 id="personal-weather-place">Weather</h2></div><button id="personal-weather-refresh" class="personal-secondary" type="button">Refresh</button></div><div id="personal-weather-content" aria-live="polite">Add a location in Settings to see your forecast.</div></article><article class="personal-card personal-calendar-card"><div class="personal-weather-head"><div><span class="personal-eyebrow">YOUR NEXT SEVEN DAYS</span><h2>Calendar</h2></div><button id="personal-calendar-refresh" class="personal-secondary" type="button">Refresh</button></div><div id="personal-calendar-content" aria-live="polite">Connect Google Calendar to see upcoming events.</div></article></div></section>
      <section id="personal-homework" class="personal-panel hidden"><p class="personal-eyebrow">YOUR OWN SCHOOL TASKS</p><h1>Homework</h1><p class="personal-lead">Add assignments, notes and due dates yourself. This is separate from WebUntis and only visible in your account.</p><form id="personal-homework-form" class="personal-card personal-homework-form"><div class="personal-homework-form-grid"><label>Subject<input id="personal-homework-subject" maxlength="80" required placeholder="e.g. English"></label><label>Task<input id="personal-homework-title" maxlength="200" required placeholder="What do you need to do?"></label><label>Due date<input id="personal-homework-due" type="date"></label><label class="personal-homework-notes">Notes<textarea id="personal-homework-details" maxlength="2000" rows="3" placeholder="Optional details"></textarea></label></div><div class="personal-homework-form-actions"><button class="personal-primary" id="personal-homework-add" type="submit">Add task</button><p id="personal-homework-status" class="personal-status" role="status"></p></div></form><div id="personal-homework-list" class="personal-homework-list" aria-live="polite">Your tasks will appear here.</div></section>
<section id="personal-setup" class="personal-panel hidden"><p class="personal-eyebrow">PERSONAL SETUP · <span id="setup-step-label">01 / 08</span></p><div class="setup-progress"><span id="setup-progress-fill"></span></div><h1 id="setup-title">Welcome</h1><p id="setup-description" class="personal-lead"></p><div id="setup-fields" class="setup-fields"></div><div class="setup-actions"><button id="setup-back" class="personal-secondary">Back</button><button id="setup-skip" class="text-button">Skip for now</button><button id="setup-next" class="personal-primary">Continue →</button></div></section>
      <section id="personal-features" class="personal-panel hidden"><p class="personal-eyebrow">MAKE IT YOURS</p><h1>Your features</h1><p class="personal-lead">Switch modules on or off whenever you like. Turning one off hides it; it does not erase its data.</p><div id="personal-feature-list" class="personal-feature-list"></div><button id="save-features" class="personal-primary">Save features</button><p id="feature-status" class="personal-status" role="status"></p></section>
      <section id="personal-connections" class="personal-panel hidden"><p class="personal-eyebrow">ACCOUNTS & SERVICES</p><h1>Connections</h1><p class="personal-lead">Each service will be connected to your own account. Administrator credentials and calendars are never reused here.</p><div class="personal-connection-list"><article class="personal-card"><div><b>Weather</b><span class="personal-connection-state connected">Available</span></div><p>Uses the location saved in your preferences. No external account or password needed.</p></article><article class="personal-card personal-untis-card"><div><b>WebUntis</b><span class="personal-connection-state pending">Awaiting platform setup</span></div><p>Personal school sign-in will use the official Untis Platform login. Kxko will never ask you to type your WebUntis password into this app, and your administrator's timetable stays private.</p><p class="personal-untis-note">This requires a registered Untis Platform application and activation by the school. The existing administrator connection uses a different legacy integration and cannot safely be reused for personal accounts.</p><a class="personal-help-link" href="https://developer.untis.com/getting-started/get-platform-application/" target="_blank" rel="noopener noreferrer">Why does this need school setup? ↗</a></article><article class="personal-card personal-google-card"><div><b>Google Calendar</b><span id="google-calendar-state" class="personal-connection-state pending">Not connected</span></div><p>Connect your own Google account. Kxko requests read-only calendar access; your refresh token is encrypted in Supabase Vault and never sent to the browser.</p><div class="personal-google-actions"><button id="connect-google-calendar" class="personal-secondary" type="button">Connect Google Calendar</button><button id="disconnect-google-calendar" class="personal-danger hidden" type="button">Disconnect</button></div><p id="google-calendar-status" class="personal-status" role="status"></p><div id="google-calendar-list" class="personal-google-list"></div></article><article class="personal-card"><div><b>Notifications</b><span class="personal-connection-state pending">Coming soon</span></div><p>Personal push delivery is not enabled yet. Existing administrator notifications remain separate.</p></article></div></section>
      <section id="personal-settings" class="personal-panel hidden"><p class="personal-eyebrow">PREFERENCES</p><h1>Settings</h1><div class="personal-card settings-card"><label>Display name<input id="setting-name" maxlength="80"></label><label>Theme<select id="setting-theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label><label>Accent colour<select id="setting-accent"><option value="amber">Warm amber</option><option value="terracotta">Terracotta</option><option value="sage">Sage green</option><option value="violet">Soft violet</option></select></label><label>Weather location<input id="setting-location" maxlength="100" placeholder="Town or city"></label><label>Layout density<select id="setting-density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button id="save-settings" class="personal-primary">Save preferences</button><p id="settings-status" class="personal-status" role="status"></p></div></section>
      <section id="personal-account" class="personal-panel hidden"><p class="personal-eyebrow">ACCOUNT & PRIVACY</p><h1>My account</h1><div class="personal-card settings-card"><p id="account-email"></p><p>Your account preferences are stored against your Supabase user ID and protected by row-level security.</p><label>New password<input id="account-new-password" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label><button id="change-password" class="personal-secondary">Change password</button><p id="password-status" class="personal-status" role="status"></p><button id="delete-account" class="personal-danger">Delete my account</button><p id="account-status" class="personal-status" role="status"></p></div></section></div></section>`;
    document.body.append(root);
    root.querySelectorAll("[data-panel]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.panel)));
    root.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showPanel(b.dataset.go)));
    $("change-password").addEventListener("click",changePassword);
    $("personal-weather-refresh").addEventListener("click",loadPersonalWeather);
    $("personal-briefing-refresh").addEventListener("click",loadPersonalBriefing);
    $("personal-calendar-refresh").addEventListener("click",loadPersonalCalendarEvents);
    $("personal-homework-form").addEventListener("submit",addPersonalHomework);
    $("connect-google-calendar").addEventListener("click",connectGoogleCalendar);
    $("disconnect-google-calendar").addEventListener("click",disconnectGoogleCalendar);
    installRecoveryPanel();
    $("personal-signout").addEventListener("click",async()=>{await db.auth.signOut();location.reload();});
    $("setup-back").addEventListener("click",()=>renderStep(Math.max(0,step-1)));
    $("setup-next").addEventListener("click",()=>{captureStep(step);step===7?finishSetup():renderStep(Math.min(7,step+1));});
    $("setup-skip").addEventListener("click",finishSetup);
    $("save-features").addEventListener("click",saveFeatures);
    $("save-settings").addEventListener("click",saveSettings);
    ["setting-theme","setting-accent","setting-density"].forEach(id=>$(id).addEventListener("change",previewSettings));
    $("delete-account").addEventListener("click",deleteAccount);
  }
  function showPanel(name) {
    document.querySelectorAll(".personal-panel").forEach(p=>p.classList.toggle("hidden",p.id!=="personal-"+name));
    document.querySelectorAll(".personal-tab").forEach(b=>b.classList.toggle("active",b.dataset.panel===name));
    if(name==="setup")renderStep(step);
    if(name==="connections"&&currentUser)loadGoogleConnection();
    if(name==="home"&&currentUser){loadPersonalCalendarEvents();loadPersonalBriefing();}
    if(name==="home"&&currentUser)loadPersonalHomework();
    if(name==="homework"&&currentUser)loadPersonalHomework();
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
    loadPersonalWeather();loadPersonalCalendarEvents();loadPersonalHomework();
    if(!profile.onboarding_completed){step=0;showPanel("setup");}
    const callbackResult=new URLSearchParams(location.search).get("google_calendar");
    if(callbackResult){
      const messages={connected:"Google Calendar connected successfully.",cancelled:"Google connection was cancelled.",invalid_state:"The connection expired or could not be verified. Please try again.",token_error:"Google did not return the required authorisation. Try connecting again.",storage_error:"The connection was approved but could not be saved securely.",callback_error:"Google Calendar could not be connected. Please try again."};
      $("google-calendar-status").textContent=messages[callbackResult]||"Google Calendar connection returned an unknown status.";
      history.replaceState(null,"",location.pathname+location.hash);
      showPanel("connections");
    }
  }
  const steps=[
    ["Welcome","A personal home for your weather, school day, calendar and more.","<p>Set up the parts you want. You can skip integrations and come back whenever you like.</p>"],
    ["Your profile","What should we call you?","<label>Preferred name<input id='wizard-name' maxlength='80' placeholder='Your name'></label>"],
    ["Appearance","Choose a look that feels right.","<label>Theme<select id='wizard-theme'><option value='dark'>Dark</option><option value='light'>Light</option><option value='system'>Use device setting</option></select></label><label>Accent<select id='wizard-accent'><option value='amber'>Warm amber</option><option value='terracotta'>Terracotta</option><option value='sage'>Sage green</option><option value='violet'>Soft violet</option></select></label>"],
    ["Weather","Where should we look for your forecast?","<label>Location<input id='wizard-location' placeholder='Town or city' value='Buseck'></label><p>Weather alerts can be configured later. No location permission is required.</p>"],
    ["School / WebUntis","Personal WebUntis access is not available yet.","<p>The existing administrator timetable is private and will not be shared with personal accounts. Do not enter your school password here.</p>"],
    ["Calendar","Connect your own Google account after setup.","<p>Calendar access is optional and read-only. Your administrator calendar is never shared with your personal account.</p>"],
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
    const moduleResults=await Promise.all(PERSONAL_MODULES.map(x=>db.from("user_modules").upsert({user_id:currentUser.id,module_key:x.id,enabled:x.available!==false&&enabled.has(x.id)},{onConflict:"user_id,module_key"})));
    const moduleError=moduleResults.find(x=>x.error)?.error;
    if(moduleError){$("setup-description").textContent="Your profile was saved, but feature settings could not be saved: "+moduleError.message;return;}
    profile.onboarding_completed=true;$("personal-setup-title").textContent="You're all set";$("personal-setup-copy").textContent="Your personal space is ready. You can revisit setup and settings any time.";applyTheme();renderModuleSummary();showPanel("home");loadPersonalWeather();loadPersonalCalendarEvents();loadPersonalHomework();
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
    const result=await Promise.all(PERSONAL_MODULES.map(x=>db.from("user_modules").upsert({user_id:currentUser.id,module_key:x.id,enabled:x.available!==false&&enabled.has(x.id)},{onConflict:"user_id,module_key"})));
    const error=result.find(x=>x.error)?.error;
    $("feature-status").textContent=error?"Couldn't save: "+error.message:"Features saved. Disabled modules keep their data.";
    if(!error){renderModuleSummary();loadPersonalCalendarEvents();loadPersonalHomework();}if(showMessage)showPanel("features");
  }
  async function saveSettings(){
    profile.display_name=$("setting-name").value.trim();
    prefs={...prefs,theme:$("setting-theme").value,accent:$("setting-accent").value,location:$("setting-location").value.trim(),density:$("setting-density").value};
    const [a,b]=await Promise.all([
      db.from("user_profiles").upsert({user_id:currentUser.id,display_name:profile.display_name},{onConflict:"user_id"}),
      db.from("user_preferences").upsert({user_id:currentUser.id,preferences:prefs},{onConflict:"user_id"})
    ]);
    $("settings-status").textContent=a.error||b.error?"Couldn't save: "+(a.error||b.error).message:"Preferences saved to your account.";
    if(a.error||b.error)return;
    $("personal-greeting").textContent="Welcome"+(profile.display_name?", "+profile.display_name:"");applyTheme();loadPersonalWeather();
  }
  function previewSettings(){
    prefs={...prefs,theme:$("setting-theme").value,accent:$("setting-accent").value,density:$("setting-density").value};
    applyTheme();
  }
  function applyTheme(){
    const root=$("personal-app");if(!root)return;
    root.dataset.theme=prefs.theme||"dark";root.dataset.accent=prefs.accent||"amber";root.dataset.density=prefs.density||"comfortable";if(root.dataset.theme==="system")root.dataset.theme=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";
  }
  async function loadPersonalCalendarEvents(){
    const panel=$("personal-calendar-content");if(!panel)return;
    if(!enabled.has("calendar")){panel.textContent="Turn on Calendar in Your features to display upcoming events.";return;}
    panel.textContent="Loading your upcoming events…";
    const {data:status,error:statusError}=await db.functions.invoke("personal-google-calendar",{body:{action:"status"}});
    if(statusError||statusError?.message){panel.textContent=statusError?.message||"Could not check your Google connection.";return;}
    if(!status?.connected){
      panel.textContent="Connect your own Google account in Connections to display calendar events.";
      return;
    }
    const {data,error}=await db.functions.invoke("personal-google-calendar",{body:{action:"events"}});
    if(error||data?.error){panel.textContent=error?.message||data?.error||"Could not load calendar events.";return;}
    const events=data.events||[];
    if(!events.length){panel.textContent="No upcoming events in the next seven days.";return;}
    const list=document.createElement("ul");list.className="personal-upcoming-list";
    events.slice(0,8).forEach(event=>{
      const item=document.createElement("li");const main=document.createElement("div");main.className="personal-event-main";
      const title=document.createElement("b");title.textContent=event.summary||"Untitled event";
      const when=document.createElement("span");
      const start=event.start?(event.allDay?new Date(event.start+"T00:00:00"):new Date(event.start)):null;
      const dateLabel=start&&!Number.isNaN(start.getTime())?start.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}):"Date unavailable";
      const timeLabel=event.allDay?"All day":start&&!Number.isNaN(start.getTime())?start.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"";
      when.textContent=dateLabel+(timeLabel?" · "+timeLabel:"");
      main.append(title,when);
      if(event.location){const place=document.createElement("small");place.textContent=event.location;main.append(place);}
      if(typeof event.htmlLink==="string"&&event.htmlLink.startsWith("https://www.google.com/calendar/")){
        const link=document.createElement("a");link.href=event.htmlLink;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Open";item.append(main,link);
      }else item.append(main);
      list.append(item);
    });
    panel.replaceChildren(list);
  }
  async function connectGoogleCalendar(){
    const button=$("connect-google-calendar");button.disabled=true;button.textContent="Opening Google…";
    $("google-calendar-status").textContent="";
    const {data,error}=await db.functions.invoke("personal-google-calendar",{body:{action:"connect"}});
    button.disabled=false;button.textContent="Connect Google Calendar";
    if(error||!data?.url){$("google-calendar-status").textContent=error?.message||data?.error||"Could not start Google sign-in.";return;}
    location.assign(data.url);
  }
  async function loadGoogleConnection(){
    const state=$("google-calendar-state"),disconnect=$("disconnect-google-calendar"),list=$("google-calendar-list");
    if(!state)return;
    state.textContent="Checking…";state.className="personal-connection-state pending";
    list.replaceChildren();
    const {data,error}=await db.functions.invoke("personal-google-calendar",{body:{action:"status"}});
    if(error||data?.error){state.textContent="Unavailable";$("google-calendar-status").textContent=error?.message||data?.error||"Could not check connection.";return;}
    if(!data.connected){state.textContent="Not connected";state.className="personal-connection-state pending";disconnect.classList.add("hidden");return;}
    state.textContent="Connected";state.className="personal-connection-state connected";disconnect.classList.remove("hidden");
    $("google-calendar-status").textContent="Connected as "+(data.connection.google_email||"your Google account")+".";
    const result=await db.functions.invoke("personal-google-calendar",{body:{action:"calendars"}});
    if(result.error||result.data?.error){$("google-calendar-status").textContent=result.error?.message||result.data?.error||"Could not load calendars.";return;}
    const heading=document.createElement("p");heading.className="personal-google-list-heading";heading.textContent="Your available calendars";list.append(heading);
    const items=result.data.calendars||[];
    if(!items.length){const empty=document.createElement("p");empty.textContent="No calendars were returned by Google.";list.append(empty);return;}
    const ul=document.createElement("ul");
    items.forEach(calendar=>{const li=document.createElement("li");const name=document.createElement("span");name.textContent=calendar.summary||"Untitled calendar";li.append(name);if(calendar.primary){const tag=document.createElement("small");tag.textContent="Primary";li.append(tag);}ul.append(li);});
    list.append(ul);
    loadPersonalCalendarEvents();
  }
  async function disconnectGoogleCalendar(){
    if(!window.confirm("Disconnect your Google Calendar? Kxko will delete the stored connection token."))return;
    const button=$("disconnect-google-calendar");button.disabled=true;
    const {data,error}=await db.functions.invoke("personal-google-calendar",{body:{action:"disconnect"}});
    button.disabled=false;
    if(error||data?.error){$("google-calendar-status").textContent=error?.message||data?.error||"Could not disconnect.";return;}
    $("google-calendar-status").textContent="Google Calendar disconnected and its stored token deleted.";
    await loadGoogleConnection();loadPersonalCalendarEvents();
  }
  async function loadPersonalBriefing(){
    const panel=$("personal-briefing-content");if(!panel||!currentUser)return;
    if(!enabled.has("briefing")){panel.textContent="Turn on Daily Overview in Your features to see your personal summary.";return;}
    panel.textContent="Putting your day together…";
    const parts=[];
    const heading=document.createElement("p");heading.className="personal-briefing-date";
    heading.textContent=new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
    parts.push(heading);
    const details=document.createElement("div");details.className="personal-briefing-parts";
    const weather=document.createElement("section");weather.className="personal-briefing-part";
    const weatherTitle=document.createElement("b");weatherTitle.textContent="Weather";
    const weatherCopy=document.createElement("span");
    if(!enabled.has("weather"))weatherCopy.textContent="Weather is switched off.";
    else try{
      const placeName=prefs.location||"Buseck";
      const geo=await fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(placeName)+"&count=1&language=en&format=json");
      if(!geo.ok)throw new Error();
      const place=(await geo.json()).results?.[0];if(!place)throw new Error();
      const url="https://api.open-meteo.com/v1/forecast?latitude="+encodeURIComponent(place.latitude)+"&longitude="+encodeURIComponent(place.longitude)+"&current=temperature_2m,weather_code,precipitation_probability&timezone=auto";
      const response=await fetch(url);if(!response.ok)throw new Error();
      const data=await response.json(),now=data.current;
      weatherCopy.textContent=now?Math.round(Number(now.temperature_2m))+"° · "+weatherDescription(Number(now.weather_code))+(now.precipitation_probability==null?"":" · "+Math.round(Number(now.precipitation_probability))+"% rain chance"):"Forecast unavailable";
    }catch{weatherCopy.textContent="Forecast unavailable — check your location or refresh weather.";}
    weather.append(weatherTitle,weatherCopy);details.append(weather);
    const agenda=document.createElement("section");agenda.className="personal-briefing-part";
    const agendaTitle=document.createElement("b");agendaTitle.textContent="Next up";
    const agendaCopy=document.createElement("span");
    if(!enabled.has("calendar"))agendaCopy.textContent="Calendar is switched off.";
    else try{
      const status=await db.functions.invoke("personal-google-calendar",{body:{action:"status"}});
      if(status.error||!status.data?.connected)agendaCopy.textContent="Connect your Google Calendar to see what's coming up.";
      else{
        const result=await db.functions.invoke("personal-google-calendar",{body:{action:"events"}});
        if(result.error||result.data?.error)throw new Error();
        const events=(result.data.events||[]).filter(event=>event.start).sort((a,b)=>new Date(a.start)-new Date(b.start));
        if(!events.length)agendaCopy.textContent="No events in the next seven days.";
        else{
          const event=events[0],start=event.allDay?new Date(event.start+"T00:00:00"):new Date(event.start);
          const when=start.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})+(event.allDay?" · All day":" · "+start.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}));
          agendaCopy.textContent=(event.summary||"Untitled event")+" · "+when;
        }
      }
    }catch{agendaCopy.textContent="Calendar events couldn't be loaded right now.";}
    agenda.append(agendaTitle,agendaCopy);details.append(agenda);
    const school=document.createElement("section");school.className="personal-briefing-part";
    const schoolTitle=document.createElement("b");schoolTitle.textContent="Homework & school";
    const schoolCopy=document.createElement("span");
    if(!enabled.has("homework"))schoolCopy.textContent="Homework is switched off. Automatic timetable/WebUntis sync is not connected.";
    else try{
      const homework=await db.from("personal_homework").select("subject,title,due_date")
        .eq("user_id",currentUser.id).eq("completed",false)
        .order("due_date",{ascending:true,nullsFirst:false}).limit(1).maybeSingle();
      if(homework.error)schoolCopy.textContent="Your next homework task couldn't be loaded.";
      else if(!homework.data)schoolCopy.textContent="No open homework tasks. Automatic timetable/WebUntis sync is not connected.";
      else{
        const task=homework.data;
        const due=task.due_date?new Date(task.due_date+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"no due date";
        schoolCopy.textContent=task.subject+" · "+task.title+" · Due "+due+". Automatic timetable/WebUntis sync is not connected.";
      }
    }catch{schoolCopy.textContent="Your next homework task couldn't be loaded.";}
    school.append(schoolTitle,schoolCopy);details.append(school);
    panel.replaceChildren(...parts,details);
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
      const url="https://api.open-meteo.com/v1/forecast?latitude="+encodeURIComponent(place.latitude)+"&longitude="+encodeURIComponent(place.longitude)+"&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3";
      const response=await fetch(url);if(!response.ok)throw new Error("Forecast service unavailable.");
      const data=await response.json(),now=data.current,days=data.daily;
      if(!now||!Array.isArray(days?.time))throw new Error("Forecast service returned incomplete data.");
      const make=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=String(value);return node;};
      $("personal-weather-place").textContent=[place.name,place.country].filter(Boolean).join(", ")||locationName;
      const current=make("div","personal-weather-now","");
      current.append(make("strong","",Math.round(Number(now.temperature_2m))+"°"));
      const details=make("div","","");
      details.append(make("b","",weatherDescription(Number(now.weather_code))));
      details.append(make("span","","Feels like "+Math.round(Number(now.apparent_temperature))+"° · "+Math.round(Number(now.relative_humidity_2m))+"% humidity"));
      current.append(details);
      const meta=make("div","personal-weather-meta","");
      meta.append(make("span","","Wind "+Math.round(Number(now.wind_speed_10m))+" km/h"));
      meta.append(make("span","","Rain "+Number(now.precipitation)+" mm"));
      const forecast=make("div","personal-forecast-list","");
      days.time.forEach((day,i)=>{
        const row=make("div","personal-forecast-day","");
        row.append(make("span","",new Date(day+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short"})));
        row.append(make("span","",weatherDescription(Number(days.weather_code?.[i]??-1))));
        row.append(make("b","",Math.round(Number(days.temperature_2m_max?.[i]))+"° / "+Math.round(Number(days.temperature_2m_min?.[i]))+"°"));
        forecast.append(row);
      });
      panel.replaceChildren(current,meta,forecast,make("small","personal-weather-source","Forecast by Open-Meteo"));
    }catch(error){panel.textContent=error.message||"Couldn't load the forecast.";}
  }
  async function loadPersonalHomework(){
    const list=$("personal-homework-list"),summary=$("personal-homework-summary");
    if(!list)return;
    const form=$("personal-homework-form");
    const summaryAction=document.querySelector(".personal-homework-summary-card [data-go]");
    if(!enabled.has("homework")){
      form?.classList.add("hidden");
      list.textContent="Turn on Homework in Your features to manage your own tasks.";
      if(summary)summary.textContent="Enable the Homework module to start adding tasks.";
      if(summaryAction){summaryAction.dataset.go="features";summaryAction.textContent="Enable homework →";}
      return;
    }
    form?.classList.remove("hidden");
    if(summaryAction){summaryAction.dataset.go="homework";summaryAction.textContent="Manage homework →";}
    list.textContent="Loading your tasks…";
    const {data,error}=await db.from("personal_homework")
      .select("id,subject,title,details,due_date,completed,created_at")
      .eq("user_id",currentUser.id)
      .order("due_date",{ascending:true,nullsFirst:false})
      .order("created_at",{ascending:false});
    if(error){
      list.textContent="Couldn't load homework: "+error.message;
      if(summary)summary.textContent="Homework could not be loaded.";
      return;
    }
    const tasks=data||[],open=tasks.filter(x=>!x.completed),done=tasks.length-open.length;
    if(summary){
      summary.replaceChildren();
      const count=document.createElement("strong");count.textContent=String(open.length);
      const label=document.createElement("span");label.textContent=" open task"+(open.length===1?"":"s");
      const completed=document.createElement("small");completed.textContent=done+" completed";
      summary.append(count,label,completed);
    }
    if(!tasks.length){list.textContent="No homework yet. Add your first task above.";return;}
    const active=document.createElement("div");active.className="personal-homework-group";
    const activeTitle=document.createElement("h2");activeTitle.textContent="To do · "+open.length;active.append(activeTitle);
    const completed=document.createElement("div");completed.className="personal-homework-group";
    const completedTitle=document.createElement("h2");completedTitle.textContent="Completed · "+done;completed.append(completedTitle);
    const makeTask=(task)=>{
      const card=document.createElement("article");card.className="personal-homework-item"+(task.completed?" is-complete":"");
      const copy=document.createElement("div");copy.className="personal-homework-copy";
      const meta=document.createElement("div");meta.className="personal-homework-meta";
      const subject=document.createElement("span");subject.textContent=task.subject;
      const due=document.createElement("span");
      if(task.due_date){
        const date=new Date(task.due_date+"T12:00:00");
        due.textContent="Due "+(Number.isNaN(date.getTime())?task.due_date:date.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}));
      }else due.textContent="No due date";
      meta.append(subject,due);
      const title=document.createElement("b");title.textContent=task.title;
      copy.append(meta,title);
      if(task.details){const notes=document.createElement("p");notes.textContent=task.details;copy.append(notes);}
      const actions=document.createElement("div");actions.className="personal-homework-actions";
      const toggle=document.createElement("button");toggle.type="button";toggle.className="personal-secondary";toggle.textContent=task.completed?"Reopen":"Mark done";
      toggle.addEventListener("click",()=>updatePersonalHomework(task.id,!task.completed));
      const remove=document.createElement("button");remove.type="button";remove.className="personal-danger";remove.textContent="Delete";
      remove.addEventListener("click",()=>deletePersonalHomework(task.id));
      actions.append(toggle,remove);card.append(copy,actions);return card;
    };
    open.forEach(task=>active.append(makeTask(task)));
    tasks.filter(x=>x.completed).forEach(task=>completed.append(makeTask(task)));
    list.replaceChildren(active,completed);
  }
  async function addPersonalHomework(event){
    event.preventDefault();
    const subject=$("personal-homework-subject").value.trim();
    const title=$("personal-homework-title").value.trim();
    const dueDate=$("personal-homework-due").value||null;
    const details=$("personal-homework-details").value.trim();
    const button=$("personal-homework-add");
    if(!subject||!title){$("personal-homework-status").textContent="Add a subject and task description.";return;}
    button.disabled=true;button.textContent="Adding…";
    const {error}=await db.from("personal_homework").insert({
      user_id:currentUser.id,subject,title,due_date:dueDate,details
    });
    button.disabled=false;button.textContent="Add task";
    if(error){$("personal-homework-status").textContent="Couldn't save task: "+error.message;return;}
    $("personal-homework-form").reset();
    $("personal-homework-status").textContent="Task added to your personal homework.";
    await loadPersonalHomework();
  }
  async function updatePersonalHomework(id,completed){
    const {data,error}=await db.from("personal_homework").update({completed})
      .eq("id",id).eq("user_id",currentUser.id).select("id").maybeSingle();
    if(error||!data){$("personal-homework-status").textContent=error?.message||"Task wasn't updated.";return;}
    $("personal-homework-status").textContent=completed?"Task marked complete.":"Task moved back to your to-do list.";
    await loadPersonalHomework();
  }
  async function deletePersonalHomework(id){
    if(!confirm("Delete this homework task?"))return;
    const {data,error}=await db.from("personal_homework").delete()
      .eq("id",id).eq("user_id",currentUser.id).select("id").maybeSingle();
    if(error||!data){$("personal-homework-status").textContent=error?.message||"Task wasn't deleted.";return;}
    $("personal-homework-status").textContent="Task deleted.";
    await loadPersonalHomework();
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
  // Native activities use the same Supabase account. Tokens are handed over only through
  // the trusted Android WebView bridge and remain encrypted by Android Keystore on-device.
  window.kxkoApplyNativeSession = async (accessToken, refreshToken) => {
    if(!accessToken||!refreshToken)return false;
    const {data:current}=await db.auth.getUser();
    if(isAdmin(current?.user))return false;
    const {error}=await db.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
    return !error;
  };
  window.kxkoClearPersonalSession = async () => {
    const {data}=await db.auth.getUser();
    if(data?.user&&!isAdmin(data.user))await db.auth.signOut();
  };
  async function boot(){
    addAuthControls();ensurePortal();installAdminTheme();installRecoveryPanel();
    db.auth.onAuthStateChange((event, session)=>{
      if(event==="PASSWORD_RECOVERY")$("password-recovery-panel")?.classList.remove("hidden");
      // Keep the native study session aligned with the personal portal. Admin credentials
      // remain deliberately isolated from native personal-account features.
      if(window.KxkoNative?.syncSupabaseSession){
        if(session?.user&&!isAdmin(session.user))window.KxkoNative.syncSupabaseSession(session.access_token,session.refresh_token);
        else window.KxkoNative.clearSupabaseSession?.();
      }
    });
    const {data}=await db.auth.getUser();
    if(data?.user&&!isAdmin(data.user))await openPersonalApp(data.user);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
