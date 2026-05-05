const QR_STORAGE_KEY = "quickReplies";

let currentReplies = [];

function saveReplies() {
  chrome.storage.local.set({ [QR_STORAGE_KEY]: currentReplies });
}

function renderList() {
  const list = document.getElementById("qr-list");
  list.innerHTML = "";

  if (currentReplies.length === 0) {
    const empty = document.createElement("div");
    empty.className = "qr-empty text-secondary small fst-italic px-1 py-2";
    empty.textContent = "No quick replies. Add one above to get started.";
    list.appendChild(empty);
    return;
  }

  currentReplies.forEach((text, index) => {
    const item = document.createElement("div");
    item.className = "qr-item";

    const textSpan = document.createElement("span");
    textSpan.className = "qr-text";
    textSpan.textContent = text;

    const actions = document.createElement("div");
    actions.className = "qr-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "qr-btn qr-edit-btn";
    editBtn.title = "Edit";
    editBtn.textContent = "✏";
    editBtn.addEventListener("click", () => startEdit(index, item, textSpan));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "qr-btn qr-delete-btn";
    deleteBtn.title = "Delete";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => {
      currentReplies.splice(index, 1);
      saveReplies();
      renderList();
      // Analytics: count only — never the deleted text.
      try {
        if (window.track) {
          window.track("quick_reply_deleted", { total_after: currentReplies.length });
        }
      } catch (e) { /* ignore */ }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(textSpan);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function startEdit(index, item, textSpan) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "qr-edit-input";
  input.value = currentReplies[index];
  input.maxLength = 200;

  const saveBtn = document.createElement("button");
  saveBtn.className = "qr-btn qr-save-btn";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "qr-btn";
  cancelBtn.textContent = "✕";

  const actions = item.querySelector(".qr-actions");
  actions.innerHTML = "";
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  item.replaceChild(input, textSpan);
  input.focus();
  input.select();

  function doSave() {
    const val = input.value.trim();
    if (val) {
      currentReplies[index] = val;
      saveReplies();
      // Analytics: no text at all — only that an edit happened.
      try {
        if (window.track) window.track("quick_reply_edited");
      } catch (e) { /* ignore */ }
    }
    renderList();
  }

  saveBtn.addEventListener("click", doSave);
  cancelBtn.addEventListener("click", renderList);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSave();
    if (e.key === "Escape") renderList();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get([QR_STORAGE_KEY], (result) => {
    const stored = result[QR_STORAGE_KEY];
    currentReplies = Array.isArray(stored) ? stored : [];
    renderList();
  });

  const addInput = document.getElementById("qr-new-input");
  const addBtn = document.getElementById("qr-add-btn");

  function addReply() {
    const val = addInput.value.trim();
    if (!val) return;
    currentReplies.push(val);
    saveReplies();
    renderList();
    addInput.value = "";
    addInput.focus();
    // Analytics: count only — never the new text.
    try {
      if (window.track) {
        window.track("quick_reply_added", { total_after: currentReplies.length });
      }
    } catch (e) { /* ignore */ }
  }

  addBtn.addEventListener("click", addReply);
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addReply();
  });
});
