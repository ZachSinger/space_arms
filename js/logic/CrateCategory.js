const CATEGORY_TAGS = Object.freeze({
  weapons: ["Firearm", "Melee"],
  ammunition: ["Ammunition"],
  attachments: ["Attachment"],
  clothing: ["Apparel"],
  armor: ["Armor"],
  tools: ["Tool"],
  survival: ["Survival"],
});

export const ITEM_CRATE_TINTS = Object.freeze({
  weapons: 0xb4aebc,
  ammunition: 0xe87565,
  attachments: 0x65b7dc,
  clothing: 0xb783d2,
  armor: 0x9db56a,
  tools: 0xe2ad4d,
  survival: 0x59b69d,
});

export function getItemCrateCategory(tags = []) {
  for (const [category, categoryTags] of Object.entries(CATEGORY_TAGS)) {
    if (categoryTags.some((tag) => tags.includes(tag))) return category;
  }
  return null;
}

export function getItemCrateTint(tags = []) {
  const category = getItemCrateCategory(tags);
  return category ? ITEM_CRATE_TINTS[category] : null;
}
