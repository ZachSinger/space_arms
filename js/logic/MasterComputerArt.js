export const MASTER_COMPUTER_SPRITE = Object.freeze({
  key: "master-computer",
  path: "img/Generated/master_computer_sheet.png",
  frameWidth: 96,
  frameHeight: 176,
  framesPerLevel: 6,
  maxLevel: 5,
});

export function masterComputerAnimationKey(level) {
  return `master-computer-level-${level}`;
}

export function createMasterComputerAnimations(scene) {
  const texture = scene.textures.get(MASTER_COMPUTER_SPRITE.key);
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  for (let level = 1; level <= MASTER_COMPUTER_SPRITE.maxLevel; level += 1) {
    const key = masterComputerAnimationKey(level);
    if (scene.anims.exists(key)) continue;
    const start = (level - 1) * MASTER_COMPUTER_SPRITE.framesPerLevel;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(MASTER_COMPUTER_SPRITE.key, {
        start,
        end: start + MASTER_COMPUTER_SPRITE.framesPerLevel - 1,
      }),
      frameRate: 6,
      repeat: -1,
    });
  }
}
