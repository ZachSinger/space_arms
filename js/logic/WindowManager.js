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

    // Global Keyboard Accessibility (Escape key)
    this.handleKeyDown = (e) => {
      if (e.key === "Escape") {
        const activeWinEl = document.querySelector(".retro-window.active");
        if (activeWinEl) {
          const activeWinObj = this.getWindow(activeWinEl.id);
          if (activeWinObj?.closable) activeWinObj.close();
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
