// ==========================================
// FILE: CrateFooter.js
// ==========================================
// The shop's bottom bar (#crate-footer in index.html) and the holding cards just above its
// right end (#holding-cards). The bar shows the picture, name, and count of the crate the
// green arrow points at; there's one card per carried crate, top crate first, matching the
// stack over the player's head. GameScene describes each crate; this only draws.

/**
 * @typedef {{ name: string, count: string, image: string | null, label?: string }} CrateDescription
 * label replaces the bar's "CRATE" heading, e.g. "SHELF" while hovering a shelf space.
 */

// The bar's height on screen; must match #crate-footer's height in the CSS.
export const CRATE_FOOTER_HEIGHT_PX = 96;

const EMPTY_FOOTER_TEXT = "Walk up to a crate to see what's inside.";

export class CrateFooter {
  /**
   * @param {Document} [doc]
   */
  constructor(doc = document) {
    this.doc = doc;
    this.footer = doc.getElementById("crate-footer");
    this.cards = doc.getElementById("holding-cards");
    if (!this.footer || !this.cards) throw new Error("Missing crate footer elements");
    this.label = this.footer.querySelector(".crate-footer-label");
    this.image = this.footer.querySelector(".crate-footer-image");
    this.name = this.footer.querySelector(".crate-footer-name");
    this.count = this.footer.querySelector(".crate-footer-count");
    this.footerKey = null;
    this.cardsKey = null;
    this.footer.classList.remove("hidden");
    this.cards.classList.remove("hidden");
    this.render({ marked: null, carried: [] });
  }

  /**
   * @param {{ marked: CrateDescription | null, carried: CrateDescription[] }} view - carried is top crate first
   */
  render({ marked, carried }) {
    const footerKey = JSON.stringify(marked);
    if (footerKey !== this.footerKey) {
      this.footerKey = footerKey;
      this.label.textContent = marked?.label ?? "CRATE";
      this.name.textContent = marked?.name ?? EMPTY_FOOTER_TEXT;
      this.name.classList.toggle("crate-footer-empty", !marked);
      this.count.textContent = marked?.count ?? "";
      this.image.classList.toggle("hidden", !marked?.image);
      if (marked?.image) this.image.src = marked.image;
      else this.image.removeAttribute("src");
    }
    const cardsKey = JSON.stringify(carried);
    if (cardsKey === this.cardsKey) return;
    this.cardsKey = cardsKey;
    this.cards.replaceChildren(...carried.map((crate) => this.createCard(crate)));
  }

  createCard({ name, count, image }) {
    const card = this.doc.createElement("div");
    card.className = "holding-card";
    const picture = this.doc.createElement("img");
    picture.className = "holding-card-image";
    picture.alt = "";
    // Cards without a picture keep its space, so every name lines up.
    if (image) picture.src = image;
    else picture.style.visibility = "hidden";
    const label = this.doc.createElement("span");
    label.className = "holding-card-name";
    label.textContent = name;
    const amount = this.doc.createElement("span");
    amount.className = "holding-card-count";
    amount.textContent = count;
    card.append(picture, label, amount);
    return card;
  }

  destroy() {
    this.footer.classList.add("hidden");
    this.cards.classList.add("hidden");
    this.cards.replaceChildren();
    this.footerKey = null;
    this.cardsKey = null;
  }
}
