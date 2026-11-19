// Staff-only uniforms and matching raised-arm sheets, with a fixed look per employee.
import manifest from "../../data/EmployeeCharacterManifest.json";
import {
  CHARACTER_ORIGIN_Y,
  CHARACTER_DISPLAY_SIZE,
  loadCharacterSheets,
  registerCharacterAnimations,
  showCharacterFacing,
  standingFrame,
} from "./CustomerSprites.js";
import { PLAYER_CRATE_HOLD_OFFSET } from "./Player.js";

const sheets = manifest.flatMap(({ key, path, carryPath }) => [
  { key, path },
  { key: `${key}_carry`, path: carryPath },
]);

// Staff art shares the player's hand height, but their origin is at their feet.
export const EMPLOYEE_CRATE_HOLD_OFFSET =
  PLAYER_CRATE_HOLD_OFFSET + (CHARACTER_ORIGIN_Y - 0.625) * CHARACTER_DISPLAY_SIZE;

export function loadEmployeeCharacters(load) {
  loadCharacterSheets(load, sheets);
}

export function registerEmployeeAnimations(textures, anims) {
  registerCharacterAnimations(textures, anims, sheets);
}

export function employeeTextureFor(id, carrying = false) {
  const entry = manifest.find((employee) => employee.id === id);
  if (!entry) throw new Error(`No employee artwork for "${id}".`);
  return `${entry.key}${carrying ? "_carry" : ""}`;
}

export function showEmployeeFacing(sprite, id, facing, moving, carrying) {
  const textureKey = employeeTextureFor(id, carrying);
  if (sprite.texture.key !== textureKey) {
    sprite.anims.stop();
    sprite.setTexture(textureKey, standingFrame(facing));
  }
  showCharacterFacing(sprite, facing, moving);
}
