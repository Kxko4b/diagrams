(() => {
  const ids = {
    time: "briefing-run-time",
    enabled: "briefing-enabled",
    sound: "briefing-sound-mode",
    vibration: "briefing-vibration",
    save: "briefing-settings-save",
    status: "briefing-settings-status",
  };
  const el = key => document.getElementById(ids[key]);
  let loading = false;

  function status(message, tone = "") {
    const node = el("status");
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone;
  }

  window.loadBriefingSettings = async function () {
    if (loading || !el("time")) return;
    loading = true;
    status("Loading saved settings…");
    try {
      const { data, error } = await db
        .from("briefing_settings")
        .select("run_time, enabled, sound_mode, vibration_enabled")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        el("time").value = String(data.run_time || "06:05").slice(0, 5);
        el("enabled").checked = data.enabled !== false;
        el("sound").value = data.sound_mode || "loud";
        el("vibration").checked = data.vibration_enabled !== false;
      }
      status("Settings loaded.");
    } catch (error) {
      console.error("Could not load briefing settings:", error);
      status("Could not load settings. Sign in with the admin account and try again.", "error");
    } finally {
      loading = false;
    }
  };

  el("save")?.addEventListener("click", async () => {
    const button = el("save");
    if (button.dataset.saving === "true") return;
    const time = el("time").value;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      status("Choose a valid time first.", "error");
      return;
    }
    button.dataset.saving = "true";
    button.disabled = true;
    status("Saving settings…");
    try {
      const { error } = await db.rpc("admin_update_briefing_settings", {
        p_run_time: time + ":00",
        p_enabled: el("enabled").checked,
        p_sound_mode: el("sound").value,
        p_vibration_enabled: el("vibration").checked,
      });
      if (error) throw error;
      status("Saved. The weekday full-briefing schedule has been updated.", "success");
    } catch (error) {
      console.error("Could not save briefing settings:", error);
      status("Save failed: " + (error?.message || "Unknown error"), "error");
    } finally {
      button.disabled = false;
      delete button.dataset.saving;
    }
  });
})();