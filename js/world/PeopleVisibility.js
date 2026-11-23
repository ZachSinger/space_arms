const PEOPLE_VISIBILITY_DEPTH = 8998;

export function isOccludedByShelf(sprite, shelves) {
  if (!sprite?.active || !sprite.getBounds) return false;
  const person = sprite.getBounds();
  return shelves.some((shelf) => {
    const image = shelf?.sprite;
    if (!image?.active || image.depth <= sprite.depth || !image.getBounds) return false;
    const bounds = image.getBounds();
    return person.left < bounds.right && person.right > bounds.left &&
      person.top < bounds.bottom && person.bottom > bounds.top;
  });
}

function syncOutline(shop, source, color, visible) {
  const outlines = shop.peopleVisibilityOutlines;
  let entry = outlines.get(source);
  if (!visible) {
    entry?.object.setVisible(false);
    return;
  }
  if (!entry) {
    const sprite = shop.add.sprite(source.x, source.y, source.texture.key, source.frame.name)
      .setOrigin(source.originX, source.originY)
      .setDepth(PEOPLE_VISIBILITY_DEPTH);
    if (sprite.preFX?.addGlow) {
      sprite.preFX.addGlow(color, 2, 0, true, 0.1, 2);
      entry = { object: sprite, boundsOutline: false };
    } else {
      sprite.destroy();
      entry = { object: shop.add.graphics().setDepth(PEOPLE_VISIBILITY_DEPTH), boundsOutline: true };
    }
    outlines.set(source, entry);
  }
  if (entry.boundsOutline) {
    const bounds = source.getBounds();
    entry.object.clear().lineStyle(2, color, 0.95)
      .strokeRect(bounds.left, bounds.top, bounds.width, bounds.height)
      .setVisible(true);
    return;
  }
  const outline = entry.object;
  if (outline.texture.key !== source.texture.key || outline.frame.name !== source.frame.name) {
    outline.setTexture(source.texture.key, source.frame.name);
  }
  outline
    .setPosition(source.x, source.y)
    .setRotation(source.rotation)
    .setFlip(source.flipX, source.flipY)
    .setDisplaySize(source.displayWidth, source.displayHeight)
    .setOrigin(source.originX, source.originY)
    .setAlpha(source.alpha)
    .setVisible(true);
}

export function syncPeopleVisibilityOutlines(shop, people) {
  if (!shop.events?.once || !shop.add?.sprite) return;
  if (!shop.peopleVisibilityOutlines) {
    shop.peopleVisibilityOutlines = new Map();
    shop.events.once("shutdown", () => {
      for (const entry of shop.peopleVisibilityOutlines.values()) entry.object.destroy();
      shop.peopleVisibilityOutlines.clear();
      delete shop.peopleVisibilityOutlines;
    });
  }
  const shelves = shop.fixtures?.shelves?.() ?? [];
  const visiblePeople = new Set();
  for (const person of people) {
    const sprite = person?.sprite ?? person;
    if (!sprite?.active) continue;
    visiblePeople.add(sprite);
    const color = sprite === shop.player?.sprite ? 0x67e8f9 : 0xfbbf24;
    syncOutline(shop, sprite, color, isOccludedByShelf(sprite, shelves));
  }
  for (const [source, entry] of shop.peopleVisibilityOutlines) {
    if (visiblePeople.has(source)) continue;
    entry.object.destroy();
    shop.peopleVisibilityOutlines.delete(source);
  }
}
