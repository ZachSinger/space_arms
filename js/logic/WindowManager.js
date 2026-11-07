// ==========================================
// FILE: WindowManager.js
// ==========================================
// Registry for the DOM UI windows: tracks focus/z-order, drives window dragging, and
// closes the active window on Escape.
// See also: UIWindow.js (individual windows register themselves here).
export class WindowManager {
  constructor() {
    this.windows = new Map(); // id -> UIWindow
    this.draggedWindow = null;
    this.currentMaxZ = 100;
    this.consumedEvents = new WeakSet(); // key events already used to close a window

    this.bindGlobalEvents();
  }

  /**
   * @param {Event} event
   * @returns {boolean} true if this event already closed a window
   */
  isConsumed(event) {
    return this.consumedEvents.has(event);
  }

  registerWindow(uiWindowInstance) {
    this.windows.set(uiWindowInstance.id, uiWindowInstance);
  }

  getWindow(id) {
    return this.windows.get(id);
  }

  // Document-level listeners so drags keep tracking when the cursor leaves the title bar.
  bindGlobalEvents() {
    this.handleMouseMove = (e) => {
      if (this.draggedWindow)
        this.draggedWindow.updateDragPosition(e.clientX, e.clientY);
    };

    this.handleMouseUp = () => {
      if (this.draggedWindow) {
        this.draggedWindow.stopDrag();
        this.draggedWindow = null;
      }
    };

    // Escape closes the focused window, if it allows closing.
    this.handleKeyDown = (e) => {
      if (e.key === "Escape") {
        const activeWinEl = document.querySelector(".retro-window.active");
        if (activeWinEl) {
          const activeWinObj = this.getWindow(activeWinEl.id);
          if (activeWinObj?.closable) {
            // Consumed, so a window revealed by this close doesn't also react to it.
            this.consumedEvents.add(e);
            activeWinObj.close();
          }
        }
      }
    };
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);
    document.addEventListener("keydown", this.handleKeyDown);
  }

  destroy() {
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
    document.removeEventListener("keydown", this.handleKeyDown);
    for (const win of this.windows.values()) {
      win.close();
      win.element.remove();
    }
    this.windows.clear();
  }

  setDraggingWindow(win) {
    this.draggedWindow = win;
    this.focusWindow(win);
  }

  focusWindow(win) {
    this.windows.forEach((w) => w.element.classList.remove("active"));
    win.element.classList.add("active");
    this.currentMaxZ++;
    win.element.style.zIndex = this.currentMaxZ;
  }

  // Focus the open window with the highest z-index (e.g. after the focused one closes).
  passFocusToNextHighest() {
    let highest = null;
    let maxZ = 0;
    this.windows.forEach((w) => {
      if (w.isOpen) {
        const z = parseInt(w.element.style.zIndex || 0);
        if (z > maxZ) {
          maxZ = z;
          highest = w;
        }
      }
    });
    if (highest) this.focusWindow(highest);
  }

  closeAllExcept(ignoreId = null) {
    this.windows.forEach((w) => {
      if (w.id !== ignoreId) w.close();
    });
  }
}
