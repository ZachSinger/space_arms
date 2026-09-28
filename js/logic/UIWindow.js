// ==========================================
// FILE: UIWindow.js
// ==========================================

export class UIWindow {
  /**
   * @param {Object} config - { id, title, contentHTML, width, height, x, y, shouldCloseOtherWindows }
   * @param {WindowManager} manager - Reference to the central window manager
   */
  constructor(config, manager) {
    this.id = config.id;
    this.title = config.title;
    this.manager = manager;

    // --- Core State Properties ---
    this.screenX = config.x || 50;
    this.screenY = config.y || 50;
    this.width = config.width || "300px";
    this.height = config.height || "auto";
    this.shouldCloseOtherWindows = config.shouldCloseOtherWindows || false;

    this.isOpen = false;
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;

    // Build DOM and inject
    this.element = this.buildHTML(config.contentHTML);
    this.bindInternalEvents();
    document.getElementById("ui-layer").appendChild(this.element);

    // Register self with the manager
    this.manager.registerWindow(this);
  }

  buildHTML(contentHTML) {
    const win = document.createElement("div");
    win.id = this.id;
    win.className = "retro-window hidden";
    win.style.width = this.width;
    win.style.height = this.height;

    win.innerHTML = `
            <div class="retro-window-header" tabindex="0" aria-label="Drag ${this.title}">
                <span class="retro-window-title">${this.title}</span>
                <button class="retro-window-close" aria-label="Close">X</button>
            </div>
            <div class="retro-window-body">
                ${contentHTML}
            </div>
        `;
    return win;
  }

  bindInternalEvents() {
    const header = this.element.querySelector(".retro-window-header");
    const closeBtn = this.element.querySelector(".retro-window-close");

    // Internal Close Button
    closeBtn.addEventListener("click", () => this.close());

    // Focus on click anywhere inside
    this.element.addEventListener("mousedown", () =>
      this.manager.focusWindow(this),
    );

    // Dragging Initialization
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest(".retro-window-close")) return;
      this.isDragging = true;
      const rect = this.element.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      this.manager.setDraggingWindow(this);
    });
  }

  // Called by WindowManager during mousemove
  updateDragPosition(clientX, clientY) {
    if (!this.isDragging) return;
    let newX = Math.max(
      0,
      Math.min(window.innerWidth - 100, clientX - this.dragOffsetX),
    );
    let newY = Math.max(
      0,
      Math.min(window.innerHeight - 50, clientY - this.dragOffsetY),
    );
    this.element.style.left = `${newX}px`;
    this.element.style.top = `${newY}px`;
  }

  // Called by WindowManager during mouseup
  stopDrag() {
    if (this.isDragging) {
      this.isDragging = false;
      // Update state to remember new location
      const rect = this.element.getBoundingClientRect();
      this.screenX = rect.left;
      this.screenY = rect.top;
    }
  }

  // --- The Primary API Methods ---
  openWindow() {
    if (this.isOpen) {
      this.manager.focusWindow(this);
      return;
    }

    // The Gatekeeper Check
    if (this.shouldCloseOtherWindows) {
      this.manager.closeAllExcept(this.id);
    }

    // Apply saved coordinates
    this.element.style.left = `${this.screenX}px`;
    this.element.style.top = `${this.screenY}px`;

    this.element.classList.remove("hidden");
    this.isOpen = true;
    this.manager.focusWindow(this);
  }

  close() {
    if (!this.isOpen) return;
    this.element.classList.add("hidden");
    this.element.classList.remove("active");
    this.isOpen = false;
    this.manager.passFocusToNextHighest();
  }
}
