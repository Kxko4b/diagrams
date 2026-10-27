const SITE_COPY_FIELDS = ["about", "terms"];

function setContentMessage(text, tone = "") {
  const message = document.getElementById("content-message");
  if (!message) return;
  message.textContent = text;
  message.dataset.tone = tone;
}

async function loadSiteContentAdmin() {
  setContentMessage("Loading website copy…");
  try {
    const { data, error } = await db
      .from("site_content")
      .select("section, content")
      .in("section", SITE_COPY_FIELDS);
    if (error) throw error;

    for (const section of SITE_COPY_FIELDS) {
      const field = document.getElementById(`content-${section}`);
      if (!field) continue;
      const row = (data || []).find(item => item.section === section);
      field.value = row?.content || "";
    }
    setContentMessage("Loaded. Changes are only published after you save.");
  } catch (error) {
    console.error("Could not load website copy:", error);
    setContentMessage(`Could not load website copy: ${error?.message || "Unknown database error"}`, "error");
  }
}

document.getElementById("content-save")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (button.dataset.saving === "true") return;
  button.dataset.saving = "true";
  button.disabled = true;
  setContentMessage("Saving website copy…");

  try {
    for (const section of SITE_COPY_FIELDS) {
      const field = document.getElementById(`content-${section}`);
      if (!field) throw new Error(`Missing editor for ${section}`);
      const value = field.value;

      // Upsert avoids the previous select-then-update flow and handles missing rows.
      const { error } = await db
        .from("site_content")
        .upsert({ section, content: value, updated_at: new Date().toISOString() }, { onConflict: "section" });
      if (error) throw error;
    }
    setContentMessage("Saved successfully. Your public website will show the updated copy after refresh.", "success");
  } catch (error) {
    console.error("Could not save website copy:", error);
    const message = error?.message || "Unknown database error";
    setContentMessage(`Save failed: ${message}. Check that you're signed in with the admin account.`, "error");
  } finally {
    button.disabled = false;
    delete button.dataset.saving;
  }
});
