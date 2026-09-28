export class DialogueWindow {
  constructor({ charactersPerSecond = 45, onComplete = null } = {}) {
    this.charactersPerSecond = charactersPerSecond;
    this.onComplete = onComplete;
    this.pages = [];
    this.pageIndex = 0;
    this.isTyping = false;
    this.timer = null;

    this.element = document.createElement("div");
    this.element.className = "retro-window dialogue-window hidden";
    this.element.innerHTML = `
      <div class="dialogue-text"></div>
      <div class="dialogue-continue">>></div>
    `;

    this.textElement = this.element.querySelector(".dialogue-text");
    this.continueElement = this.element.querySelector(".dialogue-continue");
    document.getElementById("ui-layer").appendChild(this.element);

    this.element.addEventListener("pointerdown", () => this.advance());

    this.handleKeydown = (event) => {
      if (this.element.classList.contains("hidden")) return;
      if (event.code !== "Space" && event.code !== "Enter") return;
      event.preventDefault();
      this.advance();
    };
    window.addEventListener("keydown", this.handleKeydown);
  }

  show(message) {
    this.stopTyping();
    this.pages = this.splitIntoPages(message);
    this.pageIndex = 0;
    this.element.classList.remove("hidden");
    this.showPage();
  }

  advance() {
    if (this.isTyping) {
      this.finishPage();
      return;
    }

    if (this.pageIndex < this.pages.length - 1) {
      this.pageIndex += 1;
      this.showPage();
      return;
    }

    this.hide();
    this.onComplete?.();
  }

  hide() {
    this.stopTyping();
    this.element.classList.add("hidden");
  }

  destroy() {
    this.stopTyping();
    window.removeEventListener("keydown", this.handleKeydown);
    this.element.remove();
  }

  showPage() {
    this.stopTyping();
    this.textElement.textContent = "";
    this.continueElement.classList.remove("visible");

    const page = this.pages[this.pageIndex];
    let characterIndex = 0;
    this.isTyping = true;

    this.timer = window.setInterval(() => {
      this.textElement.textContent += page[characterIndex];
      characterIndex += 1;

      if (characterIndex >= page.length) {
        this.finishPage();
      }
    }, 1000 / this.charactersPerSecond);
  }

  finishPage() {
    this.stopTyping();
    this.textElement.textContent = this.pages[this.pageIndex];
    this.continueElement.classList.add("visible");
  }

  stopTyping() {
    window.clearInterval(this.timer);
    this.timer = null;
    this.isTyping = false;
  }

  splitIntoPages(message) {
    const words = message.trim().split(/\s+/);
    const pages = [];
    let page = "";

    for (const word of words) {
      const candidate = page ? `${page} ${word}` : word;
      this.textElement.textContent = candidate;

      if (
        page &&
        this.textElement.scrollHeight > this.textElement.clientHeight
      ) {
        pages.push(page);
        page = word;
      } else {
        page = candidate;
      }
    }

    if (page) pages.push(page);
    return pages;
  }
}
