/**
 * Menu markup helper. Anything put into an html`...` template is escaped as text unless it is
 * itself html`...` (or raw(...)), so item names and other data can never break a menu's markup.
 *   panel.innerHTML = html`<li>${item.name} x ${count}</li>`;
 * Lists are joined with nothing between entries; null, undefined, and false print nothing.
 */

export class SafeHtml {
  /** @param {string} markup */
  constructor(markup) {
    this.markup = markup;
  }

  toString() {
    return this.markup;
  }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * Marks trusted markup (written in code, never from data) as safe to insert unescaped.
 * @param {string} markup
 */
export function raw(markup) {
  return new SafeHtml(markup);
}

/** @param {unknown} value @returns {string} */
function toMarkup(value) {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.markup;
  if (Array.isArray(value)) return value.map(toMarkup).join("");
  return escapeHtml(value);
}

/**
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let markup = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    markup += toMarkup(values[index]) + strings[index + 1];
  }
  return new SafeHtml(markup);
}
