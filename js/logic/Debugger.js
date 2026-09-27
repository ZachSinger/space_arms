// ==========================================
// FILE: Debugger.js
// ==========================================
export class Debugger {
  static log(message, color = "var(--color-text-main)") {
    const debugEl = document.getElementById("debug-text");
    if (debugEl) {
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
      const newEntry = `<div style="color: ${color}; margin-bottom: 2px;">[${timestamp}] ${message}</div>`;
      debugEl.innerHTML = newEntry + debugEl.innerHTML;

      const lines = debugEl.innerHTML.split("</div>");
      if (lines.length > 6)
        debugEl.innerHTML = lines.slice(0, 5).join("</div>") + "</div>";
    } else {
      console.log(`[DEBUG] ${message}`);
    }
  }
}
