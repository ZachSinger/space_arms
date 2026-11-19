// ==========================================
// FILE: Mover.js
// ==========================================
// Shared waypoint movement; the character supplies route, arrival, portal, and failure behavior.
export class Mover {
  constructor(character, {
    findPath,
    canFindPath,
    getSpeed,
    replanIntervalMs,
    waypointArrivalDistance,
    destinationArrivalDistance,
    onReroute,
    onPortal,
    onPathUnavailable,
  }) {
    this.character = character;
    this.findPath = findPath;
    this.canFindPath = canFindPath;
    this.getSpeed = getSpeed;
    this.replanIntervalMs = replanIntervalMs;
    this.waypointArrivalDistance = waypointArrivalDistance;
    this.destinationArrivalDistance = destinationArrivalDistance;
    this.onReroute = onReroute;
    this.onPortal = onPortal;
    this.onPathUnavailable = onPathUnavailable;
  }

  setDestination(targetX, targetY, onArrive, onPathUnavailable) {
    const character = this.character;
    character.destination = { x: targetX, y: targetY };
    character.onArriveAtDestination = onArrive;
    character.seekingTimer = 0;
    character.walkingMs = 0;
    character.progressCheckpoint = null;
    character.pathRetryMs = 0;

    const { x, y } = character.sprite.body?.center ?? character.sprite;
    const path = this.findPath(x, y, targetX, targetY);
    character.path = path === null ? null : path || [];
    character.onPathUnavailable = onPathUnavailable;
  }

  handlePathUnavailable() {
    this.character.sprite.body?.setVelocity(0, 0);
    this.onPathUnavailable();
  }

  repathAfterYield() {
    const character = this.character;
    if (!character.destination || !this.canFindPath()) return;
    const { x, y } = character.sprite.body?.center ?? character.sprite;
    const path = this.findPath(x, y, character.destination.x, character.destination.y);
    if (path) character.path = path;
  }

  remainingWalkDistance() {
    const character = this.character;
    let { x, y } = character.sprite.body?.center ?? character.sprite;
    let total = 0;
    for (const point of [...(character.path ?? []), character.destination].filter(Boolean)) {
      total += Math.hypot(point.x - x, point.y - y);
      ({ x, y } = point);
    }
    return total;
  }

  followPath(delta = 1000 / 60) {
    const character = this.character;
    character.pathRetryMs = Math.max(0, (character.pathRetryMs ?? 0) - delta);
    const target = character.path[0] ?? character.destination;
    const { blocked, touching } = character.sprite.body ?? {};
    const { x, y } = character.sprite.body?.center ?? character.sprite;
    const hitting = (direction) => blocked?.[direction] || touching?.[direction];
    const dx = target.x - x;
    const dy = target.y - y;
    if (character.pathRetryMs === 0 && this.canFindPath() &&
        ((dx > 0.1 && hitting("right")) || (dx < -0.1 && hitting("left")) ||
         (dy > 0.1 && hitting("down")) || (dy < -0.1 && hitting("up")))) {
      character.pathRetryMs = this.replanIntervalMs;
      character.path = this.findPath(x, y, character.destination.x, character.destination.y);
      this.onReroute();
      if (character.path === null) {
        character.sprite.body.setVelocity(0, 0);
        return;
      }
    }
    if (character.path.length > 0) {
      const waypoint = character.path[0];
      this.moveToward(
        waypoint.x, waypoint.y, () => this.reachWaypoint(waypoint),
        delta, this.waypointArrivalDistance,
      );
      return;
    }

    this.moveToward(
      character.destination.x, character.destination.y,
      () => character.onArriveAtDestination(), delta, this.destinationArrivalDistance,
    );
  }

  moveToward(targetX, targetY, onArrive, delta = 1000 / 60, arrivalDistance = this.destinationArrivalDistance) {
    const character = this.character;
    // Physics has already moved the body; the drawn sprite catches up after scene update.
    const { x, y } = character.sprite.body?.center ?? character.sprite;
    const distance = Phaser.Math.Distance.Between(x, y, targetX, targetY);

    if (distance < arrivalDistance) {
      character.sprite.body.setVelocity(0, 0);
      onArrive();
      return;
    }

    const angle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
    const stepMs = Math.max(delta, 1000 / 60);
    const speed = delta > 0 ? Math.min(this.getSpeed(), distance / (stepMs / 1000)) : 0;
    character.sprite.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  reachWaypoint(waypoint) {
    this.character.path.shift();
    if (waypoint.teleportTo) this.onPortal(waypoint.teleportTo);
  }
}
