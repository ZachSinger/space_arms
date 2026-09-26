// ==========================================
// FILE: WindowManager.js
// ==========================================
export class WindowManager {
  constructor() {
    this.windows = new Map(); // Store UIWindow class instances
    this.draggedWindow = null;
    this.currentMaxZ = 100;

    this.bindGlobalEvents();
  }

  registerWindow(uiWindowInstance) {
    this.windows.set(uiWindowInstance.id, uiWindowInstance);
  }

  getWindow(id) {
    return this.windows.get(id);
  }

  bindGlobalEvents() {
    // Global Drag Listeners
    document.addEventListener("mousemove", (e) => {
      if (this.draggedWindow)
        this.draggedWindow.updateDragPosition(e.clientX, e.clientY);
    });

    document.addEventListener("mouseup", () => {
      if (this.draggedWindow) {
        this.draggedWindow.stopDrag();
        this.draggedWindow = null;
      }
    });

    // Global Keyboard Accessibility (Escape key)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const activeWinEl = document.querySelector(".retro-window.active");
        if (activeWinEl) {
          const activeWinObj = this.getWindow(activeWinEl.id);
          if (activeWinObj) activeWinObj.close();
        }
      }
    });
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
