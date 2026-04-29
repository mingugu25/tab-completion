const editor = document.getElementById("editor");
const statusEl = document.getElementById("status");

let isRequesting = false;
let lastTriggerAt = 0;
const THROTTLE_MS = 300;
const TIMEOUT_MS = 800;

function setStatus(text) {
  statusEl.textContent = `状态：${text}`;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("请求超时")), timeoutMs);
    }),
  ]);
}

function removeOverlap(prefix, completion) {
  const maxOverlap = Math.min(prefix.length, completion.length);
  for (let i = maxOverlap; i > 0; i -= 1) {
    if (prefix.slice(-i) === completion.slice(0, i)) {
      return completion.slice(i);
    }
  }
  return completion;
}

function insertAtCursor(textarea, insertText) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${insertText}${after}`;
  const newPos = start + insertText.length;
  textarea.setSelectionRange(newPos, newPos);
}

async function requestCompletion(prefix) {
  const response = await withTimeout(
    fetch("/v1/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix,
        language: "javascript",
      }),
    }),
    TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const data = await response.json();
  return data.completion || "";
}

editor.addEventListener("keydown", async (event) => {
  if (event.key !== "Tab") return;

  event.preventDefault();

  const now = Date.now();
  if (now - lastTriggerAt < THROTTLE_MS) {
    setStatus("触发过快，已节流");
    return;
  }
  lastTriggerAt = now;

  if (isRequesting) {
    setStatus("请求进行中，已忽略");
    return;
  }

  isRequesting = true;
  setStatus("请求补全中...");

  try {
    const cursor = editor.selectionStart;
    const textBeforeCursor = editor.value.slice(0, cursor);
    const prefix = textBeforeCursor.slice(-100);

    const rawCompletion = await requestCompletion(prefix);
    const cleanCompletion = removeOverlap(prefix, rawCompletion);

    if (!cleanCompletion.trim()) {
      setStatus("无补全结果");
      return;
    }

    insertAtCursor(editor, cleanCompletion);
    setStatus(`已插入 ${cleanCompletion.length} 个字符`);
  } catch (error) {
    setStatus(error.message || "补全失败");
  } finally {
    isRequesting = false;
  }
});
