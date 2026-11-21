const STORAGE_KEY = "space-arms-dealer.cursor";
const CURSOR_ART = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="0 0 28 32"><path d="M2 2v25l7-7 5 10 5-3-5-9h10Z" fill="#bff8ff" stroke="#07121c" stroke-width="2" stroke-linejoin="round"/><path d="M5 8v12l4-4h9Z" fill="#38bdf8"/></svg>`;
const CURSOR_URL = `data:image/svg+xml,${encodeURIComponent(CURSOR_ART)}`;

export function getSavedCursorMode() {
  return localStorage.getItem(STORAGE_KEY) === "software" ? "software" : "hardware";
}

export function setCursorMode(mode, { persist = false } = {}) {
  if (mode !== "software" && mode !== "hardware") throw new RangeError(`Invalid cursor mode: ${mode}`);
  document.documentElement.dataset.gameCursor = mode;
  if (persist) localStorage.setItem(STORAGE_KEY, mode);
}

export function installGameCursor() {
  document.documentElement.style.setProperty("--game-cursor", `url("${CURSOR_URL}") 2 2, auto`);
  const cursor = document.createElement("img");
  cursor.id = "game-cursor";
  cursor.src = CURSOR_URL;
  cursor.alt = "";
  cursor.setAttribute("aria-hidden", "true");
  document.body.appendChild(cursor);
  const move = (event) => {
    cursor.style.left = `${event.clientX - 2}px`;
    cursor.style.top = `${event.clientY - 2}px`;
    cursor.classList.add("cursor-visible");
  };
  const hide = () => cursor.classList.remove("cursor-visible");
  window.addEventListener("pointermove", move, true);
  document.addEventListener("pointerleave", hide);
  window.addEventListener("blur", hide);
  setCursorMode(getSavedCursorMode());
  return () => {
    window.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerleave", hide);
    window.removeEventListener("blur", hide);
    cursor.remove();
  };
}
