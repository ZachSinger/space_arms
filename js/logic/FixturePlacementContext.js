// Everything that can change the answer to a fixture placement check.
export function fixturePlacementContext(scene) {
  const bodies = [scene.player.sprite.body, ...scene.restockCrates.map((crate) => crate.sprite.body)]
    .filter((body) => body.enable)
    .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
  return [
    scene.fixtures.layout(),
    bodies,
    scene.areas.playerArea,
    scene.room.zones.map((zone) => [
      zone.id, zone.locked, zone.gridX, zone.gridY, zone.gridW, zone.gridH, zone.salesFloor, zone.backroom,
    ]),
    [...scene.room.wallCells].map(([key, wall]) => [key, wall.door]),
  ];
}
