export const ROBOT_CHARGER_TEXTURE = "robot-charging-station";

export function createRobotTextures(scene) {
  if (scene.textures.exists(ROBOT_CHARGER_TEXTURE)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
  graphics.fillStyle(0x161b2a).fillRect(8, 4, 48, 52);
  graphics.fillStyle(0x55677e).fillRect(10, 6, 44, 48);
  graphics.fillStyle(0x263344).fillRect(14, 10, 36, 24);
  graphics.fillStyle(0x57ddcc).fillRect(19, 16, 26, 4).fillRect(27, 21, 10, 7);
  graphics.fillStyle(0x222d3c).fillRect(4, 50, 56, 10);
  graphics.fillStyle(0x8ceadd).fillRect(10, 54, 44, 3);
  graphics.generateTexture(ROBOT_CHARGER_TEXTURE, 64, 64);
  graphics.destroy();
}
