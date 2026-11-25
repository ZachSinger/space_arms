// ==========================================
// FILE: DisplayMirror.js
// ==========================================
// Copies the host's shop picture to the friend's game. The host's writer looks at every drawn
// thing in the shop (floor, shelves, people, crates, labels) and sends only what changed since
// the last update; the friend's reader keeps a matching copy and draws it with its own camera.
// Pictures the friend's game doesn't have (ones the shop draws while running) are asked for by
// name and sent once.

const SUPPORTED_TYPES = new Set(["Image", "Sprite", "Text", "Rectangle", "Arc", "Graphics", "Container"]);
// Updates arrive about this often; positions glide between them on the friend's screen.
export const MIRROR_INTERVAL_MS = 50;
// Further than this between updates is a jump (a teleport), not a glide.
const GLIDE_MAX_DISTANCE = 160;
// Something that starts moving after standing still glides over at most this long.
const GLIDE_MAX_MS = 100;
// The friend's screen shows the shop this far behind the host, so the next update is almost
// always already here to glide toward. It grows when updates arrive unevenly.
const MIN_DELAY_MS = 80;
const MAX_DELAY_MS = 350;
const MAX_QUEUED = 40;

const round = (value, places = 100) => Math.round(value * places) / places;
const comparable = (value) => (value !== null && typeof value === "object" ? JSON.stringify(value) : value);

function textStyle(text) {
  const style = text.style;
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    color: style.color,
    backgroundColor: style.backgroundColor,
    stroke: style.stroke,
    strokeThickness: style.strokeThickness,
    align: style.align,
    fixedWidth: style.fixedWidth,
    fixedHeight: style.fixedHeight,
    shadow: {
      offsetX: style.shadowOffsetX,
      offsetY: style.shadowOffsetY,
      color: style.shadowColor,
      blur: style.shadowBlur,
      stroke: style.shadowStroke,
      fill: style.shadowFill,
    },
  };
}

/**
 * Everything the friend needs to draw one object, as plain values.
 * @param {any} object - a Phaser game object
 * @returns {Record<string, any>}
 */
export function describeObject(object) {
  const description = {
    type: object.type,
    x: round(object.x),
    y: round(object.y),
    depth: object.depth,
    alpha: round(object.alpha),
    visible: object.visible,
    sx: round(object.scaleX, 10000),
    sy: round(object.scaleY, 10000),
    rot: round(object.rotation, 10000),
    sfx: object.scrollFactorX,
    sfy: object.scrollFactorY,
    blend: object.blendMode,
  };
  if (object.type === "Image" || object.type === "Sprite") {
    const crop = object.isCropped ? object._crop : null;
    Object.assign(description, {
      tex: object.texture.key,
      frame: object.frame.name,
      fx: object.flipX,
      fy: object.flipY,
      ox: object.originX,
      oy: object.originY,
      tint: object.tintTopLeft,
      tintFill: object.tintFill,
      crop: crop ? [crop.x, crop.y, crop.width, crop.height] : null,
    });
  } else if (object.type === "Text") {
    Object.assign(description, {
      // Already wrapped into lines, so the friend's copy breaks lines in the same places.
      text: object.getWrappedText().join("\n"),
      style: textStyle(object),
      pad: object.padding,
      lineSpacing: object.lineSpacing,
      ox: object.originX,
      oy: object.originY,
    });
  } else if (object.type === "Rectangle" || object.type === "Arc") {
    Object.assign(description, {
      size: object.type === "Rectangle" ? [object.width, object.height] : object.radius,
      fill: object.isFilled ? [object.fillColor, object.fillAlpha] : null,
      stroke: object.isStroked ? [object.lineWidth, object.strokeColor, object.strokeAlpha] : null,
      ox: object.originX,
      oy: object.originY,
    });
  } else if (object.type === "Graphics") {
    const commands = object.commandBuffer;
    description.cmd = commands.every((entry) => typeof entry === "number") ? commands : [];
  }
  return description;
}

/** Host side: turns the shop's drawn objects into change lists. */
export class MirrorWriter {
  constructor() {
    this.ids = new WeakMap();
    this.nextId = 1;
    this.reset();
  }

  // The next snapshot describes everything again (a friend just arrived or asked to resync).
  reset() {
    this.sent = new Map();
    this.sentOrder = new Map();
  }

  idOf(object) {
    if (!object) return 0;
    if (!this.ids.has(object)) this.ids.set(object, this.nextId++);
    return this.ids.get(object);
  }

  /**
   * @param {any[]} rootList - the scene's display list, in draw order
   * @returns {{ c: object[], r: number[], o: Record<number, number[]> } | null} null when nothing changed
   */
  snapshot(rootList) {
    const changes = [];
    const order = {};
    const seen = new Set();
    const walk = (list, parentId) => {
      const ids = [];
      for (const object of list) {
        if (!SUPPORTED_TYPES.has(object.type) || object.mirrorSkip) continue;
        const id = this.idOf(object);
        ids.push(id);
        seen.add(id);
        const description = { ...describeObject(object), p: parentId };
        const previous = this.sent.get(id);
        const change = { id };
        let changed = false;
        const record = {};
        for (const [key, value] of Object.entries(description)) {
          record[key] = comparable(value);
          if (!previous || previous[key] !== record[key]) {
            change[key] = value;
            changed = true;
          }
        }
        if (changed) changes.push(change);
        this.sent.set(id, record);
        if (object.type === "Container") walk(object.list, id);
      }
      const key = ids.join(",");
      if (this.sentOrder.get(parentId) !== key) {
        order[parentId] = ids;
        this.sentOrder.set(parentId, key);
      }
    };
    walk(rootList, 0);
    const removed = [...this.sent.keys()].filter((id) => !seen.has(id));
    removed.forEach((id) => {
      this.sent.delete(id);
      this.sentOrder.delete(id);
    });
    if (!changes.length && !removed.length && !Object.keys(order).length) return null;
    return { c: changes, r: removed, o: order };
  }
}

/**
 * Host side: a picture the friend asked for, as an image address plus its frames.
 * @param {any} textures - the scene's texture manager
 * @param {string} key
 */
export function describeTexture(textures, key) {
  if (!textures.exists(key)) return null;
  const texture = textures.get(key);
  const source = texture.getSourceImage();
  let url;
  if (typeof source?.toDataURL === "function") url = source.toDataURL();
  else if (source?.width && source?.height) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext("2d").drawImage(source, 0, 0);
    url = canvas.toDataURL();
  } else return null;
  const frames = Object.values(texture.frames)
    .filter((frame) => frame.name !== "__BASE" && frame.sourceIndex === 0)
    .map((frame) => ({ name: frame.name, x: frame.cutX, y: frame.cutY, w: frame.cutWidth, h: frame.cutHeight }));
  return { key, url, frames, nearest: texture.source[0]?.scaleMode === 1 };
}

/** Friend side: keeps a copy of the host's objects in a scene. */
export class MirrorReader {
  /**
   * @param {any} scene - the friend's Phaser scene
   * @param {(key: string) => void} requestTexture
   */
  constructor(scene, requestTexture) {
    this.scene = scene;
    this.requestTexture = requestTexture;
    this.entries = new Map();
    this.requested = new Set();
    this.queue = [];
    this.offset = undefined;
    this.lateness = 0;
    this.appliedAt = undefined;
  }

  create(type) {
    const add = this.scene.add;
    if (type === "Text") return add.text(0, 0, "");
    if (type === "Rectangle") return add.rectangle(0, 0, 1, 1);
    if (type === "Arc") return add.circle(0, 0, 1);
    if (type === "Graphics") return add.graphics();
    if (type === "Container") return add.container(0, 0);
    // Animation frames arrive in each update, so host sprites draw as plain images here.
    return add.image(0, 0, "__DEFAULT");
  }

  /**
   * An update from the host. It's shown once the friend's slightly-behind clock reaches the
   * moment the host sent it (see update).
   * @param {any} snapshot
   * @param {number} [receivedAt] - performance.now() when it arrived
   */
  apply(snapshot, receivedAt = performance.now()) {
    const sentAt = Number(snapshot.ht);
    if (!Number.isFinite(sentAt)) {
      this.applyNow(snapshot);
      return;
    }
    // The gap between the two games' clocks, from the quickest update seen; how much later
    // than that the others arrive decides how far behind to show the shop.
    const gap = receivedAt - sentAt;
    if (this.offset === undefined || gap - this.offset > 5000) {
      this.offset = gap;
      this.lateness = 0;
    } else if (gap < this.offset) this.offset = gap;
    else this.offset += (gap - this.offset) * 0.002;
    this.lateness = Math.max(gap - this.offset, this.lateness * 0.995);
    this.queue.push(snapshot);
  }

  get delayMs() {
    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, MIRROR_INTERVAL_MS * 1.4 + this.lateness + 10));
  }

  applyNow(snapshot) {
    for (const id of snapshot.r ?? []) {
      this.entries.get(id)?.object.destroy();
      this.entries.delete(id);
    }
    for (const change of snapshot.c ?? []) {
      let entry = this.entries.get(change.id);
      if (!entry || (change.type && change.type !== entry.state.type)) {
        entry?.object.destroy();
        entry = { object: this.create(change.type), state: {}, parent: 0 };
        this.entries.set(change.id, entry);
      }
      this.applyChange(entry, change);
    }
    for (const [parentId, ids] of Object.entries(snapshot.o ?? {})) this.applyOrder(Number(parentId), ids);
  }

  applyChange(entry, change) {
    const { object } = entry;
    const state = Object.assign(entry.state, change);
    if ("p" in change && change.p !== entry.parent) {
      const parent = this.entries.get(change.p)?.object;
      if (entry.parent) this.entries.get(entry.parent)?.object.remove(object);
      else this.scene.children.remove(object);
      if (parent) parent.add(object);
      else this.scene.children.add(object);
      entry.parent = parent ? change.p : 0;
    }
    if ("x" in change || "y" in change) object.setPosition(state.x, state.y);
    if ("depth" in change) object.setDepth(state.depth);
    if ("alpha" in change) object.setAlpha(state.alpha);
    if ("sx" in change || "sy" in change) object.setScale(state.sx, state.sy);
    if ("rot" in change) object.setRotation(state.rot);
    if ("sfx" in change || "sfy" in change) object.setScrollFactor(state.sfx, state.sfy);
    if ("blend" in change) object.setBlendMode(state.blend);
    if ("tex" in change || "frame" in change) this.applyTexture(entry);
    if ("fx" in change || "fy" in change) object.setFlip?.(state.fx, state.fy);
    if ("tint" in change) object.setTint?.(state.tint);
    if ("tintFill" in change) object.tintFill = state.tintFill;
    if ("crop" in change && object.setCrop) {
      if (state.crop) object.setCrop(...state.crop);
      else object.setCrop();
    }
    if ("style" in change) object.setStyle(state.style);
    if ("pad" in change && state.pad) object.setPadding(state.pad);
    if ("lineSpacing" in change) object.setLineSpacing(state.lineSpacing);
    if ("text" in change) object.setText(state.text);
    if ("size" in change) {
      if (state.type === "Arc") object.setRadius(state.size);
      else object.setSize(...state.size);
    }
    if ("fill" in change) {
      if (state.fill) object.setFillStyle(...state.fill);
      else object.isFilled = false;
    }
    if ("stroke" in change) {
      if (state.stroke) object.setStrokeStyle(...state.stroke);
      else object.isStroked = false;
    }
    if (("ox" in change || "oy" in change) && object.setOrigin) object.setOrigin(state.ox, state.oy);
    if ("cmd" in change) object.commandBuffer = state.cmd;
    if ("visible" in change || "tex" in change || "frame" in change) {
      object.setVisible(Boolean(state.visible) && entry.textureReady !== false);
    }
  }

  applyTexture(entry) {
    const { object, state } = entry;
    if (state.tex === undefined) return;
    const textures = this.scene.textures;
    const ready = textures.exists(state.tex) && textures.get(state.tex).has(state.frame);
    entry.textureReady = ready;
    if (ready) {
      object.setTexture(state.tex, state.frame);
      if (state.crop) object.setCrop(...state.crop);
      if (state.ox !== undefined) object.setOrigin(state.ox, state.oy);
    } else if (!this.requested.has(state.tex)) {
      this.requested.add(state.tex);
      this.requestTexture(state.tex);
    }
  }

  /**
   * A picture the host sent. Waits for it to decode, then redraws everything using it.
   * @param {{ key: string, url: string, frames: Array<{ name: any, x: number, y: number, w: number, h: number }>, nearest: boolean }} message
   */
  async addTexture(message) {
    const textures = this.scene.textures;
    if (!textures.exists(message.key)) {
      const image = new Image();
      image.src = message.url;
      await image.decode();
      if (!this.scene.sys.isActive() || textures.exists(message.key)) return;
      textures.addImage(message.key, image);
    }
    const texture = textures.get(message.key);
    for (const frame of message.frames) {
      if (!texture.has(frame.name)) texture.add(frame.name, 0, frame.x, frame.y, frame.w, frame.h);
    }
    if (message.nearest) texture.setFilter(1);
    this.requested.delete(message.key);
    for (const entry of this.entries.values()) {
      if (entry.state.tex !== message.key) continue;
      this.applyTexture(entry);
      entry.object.setVisible(Boolean(entry.state.visible) && entry.textureReady !== false);
    }
  }

  applyOrder(parentId, ids) {
    const objects = ids.map((id) => this.entries.get(id)?.object).filter(Boolean);
    if (parentId) {
      const container = this.entries.get(parentId)?.object;
      if (!container) return;
      const others = container.list.filter((object) => !objects.includes(object));
      container.list.splice(0, container.list.length, ...objects, ...others);
      return;
    }
    const list = this.scene.children.list;
    const others = list.filter((object) => !objects.includes(object));
    list.splice(0, list.length, ...objects, ...others);
    this.scene.children.queueDepthSort();
  }

  /**
   * Show every update whose moment has come, then glide what the next update moves.
   * @param {number} [now] - performance.now()
   */
  update(now = performance.now()) {
    if (this.offset === undefined) return;
    const showAt = now - this.offset - this.delayMs;
    while (this.queue.length && (this.queue[0].ht <= showAt || this.queue.length > MAX_QUEUED)) {
      const snapshot = this.queue.shift();
      this.applyNow(snapshot);
      this.appliedAt = snapshot.ht;
    }
    const next = this.queue[0];
    if (!next || this.appliedAt === undefined) return;
    const from = Math.max(this.appliedAt, next.ht - GLIDE_MAX_MS);
    const progress = next.ht > from ? Math.min(1, Math.max(0, (showAt - from) / (next.ht - from))) : 0;
    for (const change of next.c ?? []) {
      if (!("x" in change || "y" in change) || "p" in change) continue;
      const entry = this.entries.get(change.id);
      if (!entry || (change.type && change.type !== entry.state.type)) continue;
      const { x, y } = entry.state;
      const toX = change.x ?? x;
      const toY = change.y ?? y;
      if (Math.hypot(toX - x, toY - y) > GLIDE_MAX_DISTANCE) continue;
      entry.object.setPosition(x + (toX - x) * progress, y + (toY - y) * progress);
    }
  }

  objectFor(id) {
    return this.entries.get(id)?.object ?? null;
  }

  clear() {
    for (const entry of this.entries.values()) entry.object.destroy();
    this.entries.clear();
    this.queue = [];
  }
}
