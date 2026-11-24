import assert from "node:assert/strict";
import { startGame } from "./harness.mjs";

const h = await startGame({ port: 5399 });
try {
  await h.newGame();
  const result = await h.game(async (scene) => {
    const { SHOP_TILES } = await import("/js/logic/ShopTiles.js");
    const { BACKROOM_TILES } = await import("/js/logic/BackroomTiles.js");
    const { roomArtTexture } = await import("/js/world/RoomArt.js");
    const read = (key) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 96;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(scene.textures.get(key).getSourceImage(), 0, 0);
      return context.getImageData(0, 0, 96, 96).data;
    };
    const pairs = [
      [SHOP_TILES.floor, SHOP_TILES.doormat],
      [SHOP_TILES.backWall, SHOP_TILES.lightsLeftOfDoor],
      [SHOP_TILES.backWall, SHOP_TILES.lightsRightOfDoor],
      ...[BACKROOM_TILES.floorLeft, BACKROOM_TILES.floorRight, BACKROOM_TILES.floorBottom,
        BACKROOM_TILES.floorBottomLeft, BACKROOM_TILES.floorBottomRight]
        .map((variant) => [BACKROOM_TILES.floor, variant]),
    ];
    const details = pairs.map(([base, variant]) => {
      const oldBase = read(base);
      const oldVariant = read(variant);
      const updated = read(roomArtTexture(variant));
      let changed = 0;
      let lost = 0;
      for (let i = 0; i < oldBase.length; i += 4) {
        const differs = [0, 1, 2, 3].some((offset) => oldBase[i + offset] !== oldVariant[i + offset]);
        if (!differs) continue;
        changed += 1;
        if ([0, 1, 2, 3].some((offset) => updated[i + offset] !== oldVariant[i + offset])) lost += 1;
      }
      return { variant, changed, lost };
    });
    const allKeys = [...Object.values(SHOP_TILES), ...Object.values(BACKROOM_TILES)];
    const missing = allKeys.filter((key) => !scene.textures.exists(roomArtTexture(key)));
    const floorBefore = scene.room.floorCells.get("16,3").texture.key;
    const backroomBefore = [...scene.room.floorCells.keys()].filter((key) => Number(key.split(",")[1]) >= 100).length;
    for (const id of ["expansion_west", "expansion_a", "expansion_b", "expansion_c", "expansion_d",
      "backroom_upgrade_a", "backroom_upgrade_b", "backroom_upgrade_c"]) {
      scene.room.unlockZone(id);
    }
    const backroomAfter = [...scene.room.floorCells.keys()].filter((key) => Number(key.split(",")[1]) >= 100).length;
    const unpainted = [
      ...[...scene.room.floorCells.values()],
      ...[...scene.room.wallCells.values()].flatMap(({ image, layers }) => [image, ...layers]),
    ].filter((image) => !image.texture.key.startsWith("room-art-")).map((image) => image.texture.key);
    return { details, missing, floorBefore, backroomBefore, backroomAfter, unpainted };
  });
  assert.deepEqual(result.missing, []);
  assert.equal(result.floorBefore, "room-art-shop_floor");
  assert.ok(result.backroomAfter > result.backroomBefore, "backroom upgrades retain their floors");
  assert.deepEqual(result.unpainted, []);
  for (const { variant, changed, lost } of result.details) {
    assert.ok(changed > 0, `${variant}: original detail was not found`);
    assert.equal(lost, 0, `${variant}: original detail was lost`);
  }
  assert.deepEqual(h.errors(), []);
  console.log("Room artwork, door lights, doormat, floor edges, and expansions passed.");
} finally {
  await h.close();
}
