export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

let displaySettings = null;
const renderOutputs = new WeakMap();

export function getGameViewportLayout(width, height) {
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return {
    scale,
    offsetX: (width - DESIGN_WIDTH * scale) / 2,
    offsetY: (height - DESIGN_HEIGHT * scale) / 2,
  };
}

export function setGameDisplaySettings(settings) {
  displaySettings = settings;
  window.dispatchEvent(new Event("game-viewport-changed"));
}

export function resizeGameContainer(container, width = window.innerWidth, height = window.innerHeight) {
  const { scale } = getGameViewportLayout(width, height);
  container.style.transform = `translate(-50%, -50%) scale(${scale})`;
  return scale;
}

export function getGameRenderSize(settings = displaySettings) {
  if (!settings) return { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
  const { width, height } = settings.current ?? {};
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TypeError("Display settings must include a positive resolution.");
  }
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return {
    width: Math.max(1, Math.round(DESIGN_WIDTH * scale)),
    height: Math.max(1, Math.round(DESIGN_HEIGHT * scale)),
  };
}

export function applyGameRenderResolution(game) {
  if (!game?.canvas || !game.renderer) return;

  let output = renderOutputs.get(game);
  if (!output) {
    const source = game.canvas;
    const parent = source.parentElement;
    if (!parent) throw new Error("The game canvas must be attached before configuring its output.");
    const canvas = document.createElement("canvas");
    canvas.id = "game-render-output";
    Object.assign(canvas.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: `${DESIGN_WIDTH}px`,
      height: `${DESIGN_HEIGHT}px`,
      zIndex: "1",
      pointerEvents: "none",
    });
    parent.appendChild(canvas);

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create the game render output canvas.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    source.style.opacity = "0";
    source.style.position = "absolute";
    source.style.left = "0";
    source.style.top = "0";
    source.style.zIndex = "0";
    source.style.width = `${DESIGN_WIDTH}px`;
    source.style.height = `${DESIGN_HEIGHT}px`;

    output = { canvas, context, source };
    renderOutputs.set(game, output);
    game.renderer.on("postrender", () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    });
  }

  const { width, height } = getGameRenderSize();
  if (output.canvas.width !== width || output.canvas.height !== height) {
    output.canvas.width = width;
    output.canvas.height = height;
  }
}

export function getGameScale() {
  const container = document.getElementById("game-container");
  const rect = container?.getBoundingClientRect();
  return rect?.width > 0 ? rect.width / DESIGN_WIDTH : 1;
}

export function clientToGamePoint(clientX, clientY) {
  const container = document.getElementById("game-container");
  const rect = container?.getBoundingClientRect();
  const scale = rect?.width > 0 ? rect.width / DESIGN_WIDTH : 1;
  return {
    x: (clientX - (rect?.left ?? 0)) / scale,
    y: (clientY - (rect?.top ?? 0)) / scale,
  };
}
