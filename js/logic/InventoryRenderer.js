// ==========================================
// FILE: InventoryRenderer.js
// ==========================================
export class InventoryRenderer {
  static generateHTML(databaseManager) {
    const items = databaseManager.getAllItems();

    let html = `
        <div style="display: flex; gap: 4px; margin-bottom: 10px;">
            <button class="retro-tab-btn">Shift</button>
            <button class="retro-tab-btn active">Inventory DB</button>
            <button class="retro-tab-btn">Finances</button>
        </div>
        <div class="retro-slot custom-scrollbar inventory-list" style="padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; overflow-y: auto;">
    `;

    items.forEach((item, index) => {
      // Map the tags array into HTML pills
      const tagHTML = item.tags
        .map((t) => `<span class="tag-badge">${t}</span>`)
        .join("");

      // Conditionally generate the extra data row ONLY if ammo or count exist
      let extraDataHTML = "";
      if (item.ammo || item.count) {
        const ammoSpan = item.ammo
          ? `<span>Uses: ${item.ammo}</span>`
          : `<span></span>`;
        const countSpan = item.count
          ? `<span>Qty: ${item.count}</span>`
          : `<span></span>`;

        // This ensures the optional row stays perfectly formatted and independent
        extraDataHTML = `
                <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #eab308;">
                    ${ammoSpan}
                    ${countSpan}
                </div>
            `;
      }

      // Build the card layout (each field is a fixed grid column)
      html += `
            <div class="item-card inventory-item-card" data-index="${index}">
                <span class="item-card-title">${item.name}</span>
                <span class="item-card-cost">${item.baseCost}c</span>
                <div class="item-card-flavor">"${item.flavor}"</div>
                <div class="item-card-tags">
                    ${tagHTML}
                </div>
                <div class="item-card-footer">
                    <div class="item-card-footer-row">
                        <span>Dim: [${item.dimensions.w}x${item.dimensions.h}]</span>
                        <span>Stack: x${item.stackSize}</span>
                    </div>
                    ${extraDataHTML}
                </div>
            </div>
        `;
    });

    html += `</div>`;
    return html;
  }

  // Wires arrow-key/hover selection with auto-scroll; returns a teardown function.
  static enableListNavigation(rootElement) {
    const list = rootElement.querySelector(".inventory-list");
    const cards = list ? Array.from(list.querySelectorAll(".item-card")) : [];

    if (cards.length === 0) {
      return () => {};
    }

    let selectedIndex = 0;

    const selectCard = (index) => {
      cards[selectedIndex]?.classList.remove("selected");
      selectedIndex = Math.max(0, Math.min(index, cards.length - 1));

      const card = cards[selectedIndex];
      card.classList.add("selected");
      card.scrollIntoView({ block: "nearest" });
    };

    const handlePointerEnter = (event) => {
      const index = Number(event.currentTarget.dataset.index);
      selectCard(index);
    };

    cards.forEach((card) =>
      card.addEventListener("pointerenter", handlePointerEnter),
    );

    const handleKeydown = (event) => {
      if (rootElement.classList.contains("hidden")) return;

      if (event.code === "ArrowDown") {
        event.preventDefault();
        selectCard(selectedIndex + 1);
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        selectCard(selectedIndex - 1);
      }
    };

    window.addEventListener("keydown", handleKeydown);
    selectCard(0);

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      cards.forEach((card) =>
        card.removeEventListener("pointerenter", handlePointerEnter),
      );
    };
  }
}
