// ==========================================
// FILE: UIWindow.js
// ==========================================
// A retro DOM window in the #ui-layer. Open/close/focus order is coordinated by
// WindowManager, which also forwards drag mouse events for windows created draggable.

export class UIWindow {
  /**
   * @param {Object} config - { id, title, contentHTML, width, height, x, y, closable, draggable, shouldCloseOtherWindows, onClose }
   * @param {WindowManager} manager
   */
  constructor(config, manager) {
    this.id = config.id;
    this.title = config.title;
    this.manager = manager;

    this.screenX = config.x || 50;
    this.screenY = config.y || 50;
    this.width = config.width || "300px";
    this.height = config.height || "auto";
    this.shouldCloseOtherWindows = config.shouldCloseOtherWindows || false;
    // false hides the X and ignores Escape; code can still call close().
    this.closable = config.closable !== false;
    // Windows stay where they open unless created with draggable: true.
    this.draggable = config.draggable === true;
    // Fired only on an actual close (X, Escape, or close()), not on content refresh.
    // May be assigned after construction.
    this.onClose = config.onClose || null;

    this.isOpen = false;
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;

    this.element = this.buildHTML(config.contentHTML);
    this.bindInternalEvents();
    document.getElementById("ui-layer").appendChild(this.element);

    this.manager.registerWindow(this);
  }

  buildHTML(contentHTML) {
    const win = document.createElement("div");
    win.id = this.id;
    win.className = `retro-window hidden${this.draggable ? " draggable" : ""}`;
    win.style.width = this.width;
    win.style.height = this.height;

    win.innerHTML = `
            <div class="retro-window-header"${this.draggable ? ` tabindex="0" aria-label="Drag ${this.title}"` : ""}>
                <span class="retro-window-title">${this.title}</span>
                ${this.closable ? '<button class="retro-window-close" aria-label="Close">X</button>' : ""}
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

    closeBtn?.addEventListener("click", () => this.close());

    this.element.addEventListener("mousedown", () =>
      this.manager.focusWindow(this),
    );

    header.addEventListener("mousedown", (e) => {
      if (!this.draggable || e.target.closest(".retro-window-close")) return;
      this.isDragging = true;
      const rect = this.element.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      this.manager.setDraggingWindow(this);
    });
  }

  /**
   * Follow the mouse while dragging, keeping part of the window on screen. Called by
   * WindowManager on mousemove.
   * @param {number} clientX
   * @param {number} clientY
   */
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

  // Called by WindowManager on mouseup; remembers where the window was dropped.
  stopDrag() {
    if (this.isDragging) {
      this.isDragging = false;
      const rect = this.element.getBoundingClientRect();
      this.screenX = rect.left;
      this.screenY = rect.top;
    }
  }

  // Show at the remembered position, or just focus if already open.
  openWindow() {
    if (this.isOpen) {
      this.manager.focusWindow(this);
      return;
    }

    if (this.shouldCloseOtherWindows) {
      this.manager.closeAllExcept(this.id);
    }

    this.element.style.left = `${this.screenX}px`;
    this.element.style.top = `${this.screenY}px`;

    this.element.classList.remove("hidden");
    this.isOpen = true;
    this.manager.focusWindow(this);
  }

  close() {
    if (!this.isOpen) return;
    // Hiding a focused field doesn't reliably fire blur; force it so edits commit.
    if (this.element.contains(document.activeElement)) document.activeElement.blur();
    this.element.classList.add("hidden");
    this.element.classList.remove("active");
    this.isOpen = false;
    this.manager.passFocusToNextHighest();
    this.onClose?.();
  }
}
