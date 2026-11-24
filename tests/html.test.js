import { test } from "node:test";
import assert from "node:assert/strict";
import { html, raw } from "../js/core/html.js";

test("data inserted into menu markup is shown as text, never as markup", () => {
  const name = `<img src=x onerror="alert(1)"> & 'Co'`;

  assert.equal(String(html`<li title="${name}">${name}</li>`),
    `<li title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Co&#39;">` +
    `&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Co&#39;</li>`);
});

test("nested templates, lists, and trusted markup stay markup; empty values print nothing", () => {
  const rows = ["a<b", "c"].map((text) => html`<li>${text}</li>`);

  assert.equal(String(html`<ul>${rows}</ul>${null}${undefined}${false}${0}${raw("<hr>")}`),
    "<ul><li>a&lt;b</li><li>c</li></ul>0<hr>");
});
