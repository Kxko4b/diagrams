(() => {
  const ids = {
    list: "briefing-schedules-list",
    add: "briefing-schedule-add",
    save: "briefing-settings-save",
    status: "briefing-settings-status",
  };
  const el = key => document.getElementById(ids[key]);
  let loading = false;
  let schedules = [];

  const makeId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

  function status(message, tone = "") {
    const node = el("status");
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone;
  }

  function renderSchedules() {
    const list = el("list");
    if (!list) return;
    if (!schedules.length) {
      list.innerHTML = '<p class="muted">No automatic briefings scheduled. Add a time to create one.</p>';
      return;
    }
    list.innerHTML = schedules.map((item, index) => `
      <div class="briefing-schedule-row" data-schedule-id="${escapeHtml(item.id)}">
        <label>Run time
          <input type="time" data-field="run_time" value="${escapeHtml(item.run_time || "")}" required>
        </label>
        <label>Notification
          <select data-field="sound_mode">
            <option value="loud" ${item.sound_mode === "loud" ? "selected" : ""}>Loud</option>
            <option value="silent" ${item.sound_mode === "silent" ? "selected" : ""}>Silent</option>
          </select>
        </label>
        <label class="briefing-schedule-toggle"><input type="checkbox" data-field="enabled" ${item.enabled ? "checked" : ""}> Enabled</label>
        <button type="button" class="briefing-schedule-remove" data-action="remove" aria-label="Delete briefing at ${escapeHtml(item.run_time)}">Delete</button>
      </div>`).join("");
  }

  window.loadBriefingSettings = async function () {
    if (loading || !el("list")) return;
    loading = true;
    status("Loading saved briefing times…");
    try {
      const { data, error } = await db
        .from("briefing_schedules")
        .select("id, run_time, enabled, sound_mode, vibration_enabled")
        .order("run_time", { ascending: true });
      if (error) throw error;
      schedules = (data || []).map(row => ({
        id: row.id,
        run_time: String(row.run_time || "").slice(0, 5),
        enabled: row.enabled !== false,
        sound_mode: row.sound_mode || "loud",
        vibration_enabled: row.vibration_enabled !== false,
      }));
      renderSchedules();
      status(schedules.length ? "Saved briefing times loaded." : "No briefing times yet. Add one to get started.");
    } catch (error) {
      console.error("Could not load briefing settings:", error);
      status("Could not load settings. Sign in with the admin account and try again.", "error");
    } finally {
      loading = false;
    }
  };

  el("add")?.addEventListener("click", () => {
    if (schedules.length >= 12) {
      status("You can schedule up to 12 briefing times.", "error");
      return;
    }
    schedules.push({ id: makeId(), run_time: "", enabled: true, sound_mode: "loud", vibration_enabled: true });
    renderSchedules();
    const last = el("list")?.lastElementChild?.querySelector('input[type="time"]');
    last?.focus();
    status("New time added. Choose a time, then save.");
  });

  el("list")?.addEventListener("input", event => {
    const row = event.target.closest("[data-schedule-id]");
    const field = event.target.dataset.field;
    if (!row || !field) return;
    const item = schedules.find(x => x.id === row.dataset.scheduleId);
    if (item && field === "run_time") item.run_time = event.target.value;
  });

  el("list")?.addEventListener("change", event => {
    const row = event.target.closest("[data-schedule-id]");
    const field = event.target.dataset.field;
    if (!row || !field) return;
    const item = schedules.find(x => x.id === row.dataset.scheduleId);
    if (!item) return;
    if (field === "enabled") item.enabled = event.target.checked;
    if (field === "sound_mode") item.sound_mode = event.target.value;
  });

  el("list")?.addEventListener("click", event => {
    const button = event.target.closest('[data-action="remove"]');
    if (!button) return;
    const row = button.closest("[data-schedule-id]");
    schedules = schedules.filter(x => x.id !== row.dataset.scheduleId);
    renderSchedules();
    status("Time removed. Save to apply the change.");
  });

  el("save")?.addEventListener("click", async () => {
    const button = el("save");
    if (button.dataset.saving === "true") return;
    const seen = new Set();
    for (const item of schedules) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.run_time)) {
        status("Choose a valid time for every briefing.", "error");
        return;
      }
      if (seen.has(item.run_time)) {
        status("Each briefing needs a different time. Remove duplicate times first.", "error");
        return;
      }
      seen.add(item.run_time);
    }
    button.dataset.saving = "true";
    button.disabled = true;
    status("Saving and updating the weekday scheduler…");
    try {
      const payload = schedules.map(item => ({
        id: item.id,
        run_time: item.run_time,
        enabled: item.enabled,
        sound_mode: item.sound_mode,
        vibration_enabled: item.vibration_enabled,
      }));
      const { data, error } = await db.rpc("admin_save_briefing_schedules", { p_schedules: payload });
      if (error) throw error;
      schedules = (data || []).map(item => ({
        id: item.id, run_time: item.run_time, enabled: item.enabled,
        sound_mode: item.sound_mode, vibration_enabled: item.vibration_enabled,
      }));
      renderSchedules();
      status("Saved. Your weekday briefing times and notification sounds are now active.", "success");
    } catch (error) {
      console.error("Could not save briefing settings:", error);
      status("Save failed: " + (error?.message || "Unknown error"), "error");
    } finally {
      button.disabled = false;
      delete button.dataset.saving;
    }
  });
})();