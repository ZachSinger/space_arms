export const DRONE_TERMINAL_PLATFORM_SPRITE = Object.freeze({
  key: "fixture_drone_terminal_sheet",
  path: "img/Generated/fixture_drone_terminal_sheet.png",
  frameWidth: 120,
  frameHeight: 81,
});

export const DRONE_TERMINAL_SCREEN_SPRITE = Object.freeze({
  key: "fixture_drone_terminal_screen_sheet",
  path: "img/Generated/fixture_drone_terminal_screen_sheet.png",
  frameWidth: 16,
  frameHeight: 15,
});

export const REMOTE_ORDER_CRATE_SPRITES = Object.freeze({
  incomplete: Object.freeze({
    key: "remote-order-crate-red",
    path: "img/Generated/remote_order_crate_red_sheet.png",
    frameWidth: 29,
    frameHeight: 35,
    width: 32,
    height: 36,
    animation: "remote-order-crate-lid-red",
  }),
  complete: Object.freeze({
    key: "remote-order-crate-green",
    path: "img/Generated/remote_order_crate_green_sheet.png",
    frameWidth: 29,
    frameHeight: 35,
    width: 32,
    height: 36,
    animation: "remote-order-crate-lid-green",
  }),
});

export const DRONE_TERMINAL_FRAME_MS = 60;
