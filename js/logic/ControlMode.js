export const CONTROL_MODES = Object.freeze({
  LOADING: "loading",
  PLACING: "placing",
  MODAL: "modal",
  REGISTER: "register",
  CARRYING: "carrying",
  WALKING: "walking",
});

const REGISTER_WINDOWS = new Set(["checkout-window", "go-backs-window"]);

const CONTROL_PROFILES = Object.freeze({
  [CONTROL_MODES.LOADING]: new Set(),
  [CONTROL_MODES.PLACING]: new Set(["rotateFixture", "cameraZoom", "debugGrid"]),
  [CONTROL_MODES.MODAL]: new Set(),
  [CONTROL_MODES.REGISTER]: new Set(["interact", "crate", "goBacks", "tablet", "debug", "debugGrid", "pause", "cameraZoom"]),
  [CONTROL_MODES.CARRYING]: new Set(["move", "interact", "crate", "goBacks", "tablet", "debug", "debugGrid", "pause", "cameraZoom"]),
  [CONTROL_MODES.WALKING]: new Set(["move", "interact", "crate", "goBacks", "tablet", "debug", "debugGrid", "pause", "cameraZoom"]),
});

export class ControlMode {
  constructor(scene) {
    this.scene = scene;
    this.mode = null;
    this.refresh();
  }

  refresh() {
    const scene = this.scene;
    const openWindows = [...(scene.windowManager?.windows?.values() ?? [])]
      .filter((window) => window.isOpen);
    const hasBlockingModal = openWindows.some((window) =>
      !scene.operatingRegister || !REGISTER_WINDOWS.has(window.id));

    let nextMode = CONTROL_MODES.WALKING;
    if (scene.loadFailed || scene.startingShift) nextMode = CONTROL_MODES.LOADING;
    else if (scene.fixturePlacement?.active) nextMode = CONTROL_MODES.PLACING;
    else if (hasBlockingModal) nextMode = CONTROL_MODES.MODAL;
    else if (scene.operatingRegister) nextMode = CONTROL_MODES.REGISTER;
    else if (scene.carriedCrate) nextMode = CONTROL_MODES.CARRYING;

    this.mode = nextMode;
    return this.mode;
  }

  getMode() {
    return this.refresh();
  }

  allows(action) {
    return CONTROL_PROFILES[this.refresh()].has(action);
  }
}
