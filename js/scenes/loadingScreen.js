// The full-screen "LOADING..." cover (#loading-screen in index.html). Setting up a shop runs
// in one go and freezes the page, so the cover has to be drawn before that work starts.

function element() {
  return document.getElementById("loading-screen");
}

/**
 * Shows the cover, waits until the browser has drawn it, then runs `start`.
 * @param {() => void} start
 */
export function showLoadingThen(start) {
  element()?.classList.remove("hidden");
  requestAnimationFrame(() => requestAnimationFrame(start));
}

export function hideLoadingScreen() {
  element()?.classList.add("hidden");
}
