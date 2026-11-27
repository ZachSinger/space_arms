import { UIWindow } from "./UIWindow.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "./GameViewport.js";
import {
  MASTER_COMPUTER_UPGRADE_PRICES,
  PREBUILT_ROBOTS,
  ROBOT_PART_CATALOG,
  ROBOT_PART_GROUPS,
  ROBOT_PARTS,
  ROBOT_SERVICE_LEVEL,
  getRobotPart,
  isRobotPartUnlocked,
  isRobotServiceUnlocked,
} from "./RobotServiceCatalog.js";
import { fixtureBounds, getFixtureType } from "./FixtureLayout.js";
import { TILE_SIZE } from "./RoomLayout.js";
import { controlLabel } from "../input/InputDevice.js";

const MASTER_COMPUTER_TYPE = "master_computer";

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function money(value) {
  return Number(value).toLocaleString();
}

export class RobotServiceTab {
  constructor(scene, gameState, system) {
    this.scene = scene;
    this.gameState = gameState;
    this.system = system;
    this.panel = null;
    this.terminalTab = "robots";
    const width = Math.min(960, DESIGN_WIDTH - 40);
    const height = Math.min(660, DESIGN_HEIGHT - 40);
    this.terminalWindow = new UIWindow({
      id: "master-terminal-window",
      title: "MASTER TERMINAL",
      contentHTML: `
        <div class="master-terminal-app">
          <div class="master-terminal-status" data-terminal-status></div>
          <nav class="master-terminal-tabs" aria-label="Master Terminal">
            <button type="button" data-terminal-tab="robots">ROBOTS</button>
            <button type="button" data-terminal-tab="depot">ROBOT DEPOT</button>
            <button type="button" data-terminal-tab="parts">PARTS</button>
          </nav>
          <div class="master-terminal-content" data-terminal-content></div>
        </div>
      `,
      width: `${width}px`,
      height: `${height}px`,
      x: Math.round((DESIGN_WIDTH - width) / 2),
      y: Math.round((DESIGN_HEIGHT - height) / 2),
      shouldCloseOtherWindows: true,
    }, scene.windowManager);
    this.terminalContent = this.terminalWindow.element.querySelector("[data-terminal-content]");
    this.terminalWindow.element.addEventListener?.("click", (event) => this.handleTerminalClick(event));
    this.terminalWindow.element.addEventListener?.("submit", (event) => this.handleTerminalSubmit(event));
    const keyboard = scene.input?.keyboard;
    if (keyboard) {
      this.terminalWindow.element.addEventListener?.("focusin", (event) => {
        if (!event.target.matches("input, select, textarea")) return;
        keyboard.enabled = false;
        keyboard.disableGlobalCapture();
        keyboard.resetKeys();
      });
      this.terminalWindow.element.addEventListener?.("focusout", (event) => {
        if (!event.target.matches("input, select, textarea")) return;
        if (!event.relatedTarget?.matches?.("input, select, textarea")) {
          keyboard.enabled = true;
          keyboard.enableGlobalCapture();
        }
      });
    }
    this.unregisterInteractions = scene.interactables?.registerProvider?.("master-terminal", () =>
      scene.fixtures.ofKind(MASTER_COMPUTER_TYPE).map((fixture) => ({
        id: `master-terminal:${fixture.id}`,
        kind: "master-terminal",
        target: fixture,
        range: 24,
        distanceFrom: (origin) => {
          const bounds = fixtureBounds(fixture);
          return scene.interactionSystem.feetReachTo(origin, {
            left: bounds.left * TILE_SIZE,
            top: bounds.top * TILE_SIZE,
            right: bounds.right * TILE_SIZE,
            bottom: bounds.bottom * TILE_SIZE,
          });
        },
        getActions: (player) => scene.interactionSystem.isPlayerFacingFixture(fixture, player)
          ? [{
            action: "interact",
            hint: `${controlLabel("interact")}: Open the Master Terminal`,
            perform: () => this.openTerminal(),
          }]
          : [],
      }))) ?? null;
  }

  draw() {
    const serviceUnlocked = isRobotServiceUnlocked(this.gameState.reputation.shopLevel);
    const level = this.gameState.robotService.masterComputerLevel;
    const placed = (this.scene.fixtures?.ofKind?.(MASTER_COMPUTER_TYPE)?.length ?? 0) > 0;
    const computerType = getFixtureType(MASTER_COMPUTER_TYPE);
    const crateWaiting = (this.scene.restockCrates ?? []).some((crate) =>
      crate.kind === "fixture" && crate.typeId === MASTER_COMPUTER_TYPE) ||
      this.scene.carriedCrate?.kind === "fixture" && this.scene.carriedCrate.typeId === MASTER_COMPUTER_TYPE;

    if (!level) {
      return `
        <div class="robot-service-page">
          <p class="robot-service-intro">Buy a Master Computer to run robots. Its racks set how many robots your shop can have.</p>
          ${!serviceUnlocked ? `<p class="robot-service-notice">Unlocks at Shop Level ${ROBOT_SERVICE_LEVEL}.</p>` : ""}
          <article class="robot-service-card">
            <div>
              <h2>MASTER COMPUTER</h2>
              <p>Starts with 1 rack and runs 1 robot. Buy upgrades to add more racks.</p>
            </div>
            <div class="robot-service-buy">
              <strong>${money(computerType.price)}</strong>
              <button type="button" data-buy-master-computer ${serviceUnlocked ? "" : "disabled"}>BUY</button>
            </div>
          </article>
        </div>
      `;
    }

    const status = placed
      ? `Your Master Computer has ${level} rack${level === 1 ? "" : "s"} and can run ${level} robot${level === 1 ? "" : "s"}.`
      : crateWaiting
        ? "Your Master Computer is waiting on the Loading Pad. Place it in the shop to use it."
        : "Place your Master Computer in the shop to use it.";
    const upgrades = MASTER_COMPUTER_UPGRADE_PRICES.map((price, index) => {
      const targetLevel = index + 2;
      const upgradeNumber = targetLevel - 1;
      const owned = level >= targetLevel;
      const available = level === targetLevel - 1 && placed && serviceUnlocked;
      const note = owned
        ? "OWNED"
        : !placed
          ? "Place the Master Computer first"
          : level < targetLevel - 1
            ? `Buy Computer Upgrade ${upgradeNumber - 1} first`
            : "";
      return `
        <article class="robot-service-card${owned ? " owned" : ""}">
          <div>
            <h2>COMPUTER UPGRADE ${upgradeNumber}</h2>
            <p>Adds a rack, letting your Master Computer run up to ${targetLevel} robots instead of ${targetLevel - 1}.</p>
          </div>
          <div class="robot-service-buy">
            <strong>${money(price)}</strong>
            ${owned
              ? `<span class="robot-service-owned">${note}</span>`
              : `<button type="button" data-buy-computer-upgrade="${targetLevel}" ${available ? "" : "disabled"}>BUY</button>
                 ${note ? `<span class="robot-service-lock-note">${escapeHTML(note)}</span>` : ""}`}
          </div>
        </article>
      `;
    }).join("");

    return `
      <div class="robot-service-page">
        <p class="robot-service-intro">${escapeHTML(status)}</p>
        <h2 class="robot-service-section-title">MASTER COMPUTER</h2>
        <article class="robot-service-card owned">
          <div><h2>MASTER COMPUTER</h2><p>Runs up to ${level} robot${level === 1 ? "" : "s"}.</p></div>
          <span class="robot-service-owned">OWNED</span>
        </article>
        <h2 class="robot-service-section-title">UPGRADES</h2>
        ${upgrades}
      </div>
    `;
  }

  bind(panel, eventRoot, renderPanel = () => this.draw()) {
    if (!panel) throw new Error("Robot Service tab panel is missing.");
    this.panel = panel;
    this.renderPanel = renderPanel;
    eventRoot.addEventListener("click", (event) => this.handleShopClick(event));
  }

  handleShopClick(event) {
    if (!(event.target instanceof Element) || !this.panel?.contains(event.target)) return;
    const computerButton = event.target.closest("[data-buy-master-computer]");
    if (computerButton) {
      this.system.buyMasterComputer();
      return;
    }
    const upgradeButton = event.target.closest("[data-buy-computer-upgrade]");
    if (upgradeButton) this.system.buyMasterComputerUpgrade(Number(upgradeButton.dataset.buyComputerUpgrade));
  }

  redraw() {
    if (this.panel) this.panel.innerHTML = this.renderPanel();
    for (const fixture of this.scene.fixtures?.ofKind?.(MASTER_COMPUTER_TYPE) ?? []) {
      this.scene.fixtureViews?.orient?.(fixture);
    }
    if (this.terminalWindow.isOpen) this.renderTerminal();
  }

  openTerminal() {
    if (!this.system.masterComputerPlaced()) return;
    this.terminalWindow.openWindow();
    this.renderTerminal();
  }

  renderTerminal() {
    const level = this.gameState.robotService.masterComputerLevel;
    const robots = this.gameState.robotService.robots;
    const atCapacity = robots.length >= level;
    const status = `${robots.length} / ${level} ROBOT${level === 1 ? "" : "S"} RUNNING`;
    this.terminalWindow.element.querySelector("[data-terminal-status]").textContent = status;
    this.terminalWindow.element.querySelectorAll("[data-terminal-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.terminalTab === this.terminalTab);
      button.setAttribute("aria-current", button.dataset.terminalTab === this.terminalTab ? "page" : "false");
    });
    if (this.terminalTab === "depot") this.terminalContent.innerHTML = this.drawDepot(atCapacity);
    else if (this.terminalTab === "parts") this.terminalContent.innerHTML = this.drawParts();
    else this.terminalContent.innerHTML = this.drawRobots();
  }

  drawRobots() {
    const robots = this.gameState.robotService.robots;
    const cards = robots.length ? robots.map((robot) => {
      const parts = [robot.frame, robot.cell, ...robot.boards.map(({ board }) => board)]
        .map((id) => getRobotPart(id)?.name ?? id)
        .map(escapeHTML).join(", ");
      const onShift = robot.onShift !== false;
      return `
        <article class="master-terminal-card">
          <div>
            <h2>${escapeHTML(robot.name)}</h2>
            <p>${onShift ? "On shift" : "Off shift"} · ${Math.round((robot.battery ?? 1) * 100)}% charge</p>
            <p>${parts}</p>
          </div>
          <div class="master-terminal-actions">
            <button type="button" data-robot-shift="${escapeHTML(robot.id)}" data-on-shift="${!onShift}">
              SET ${onShift ? "OFF" : "ON"} SHIFT
            </button>
            <button type="button" data-robot-recharge="${escapeHTML(robot.id)}">RECHARGE</button>
            <button type="button" data-robot-dismantle="${escapeHTML(robot.id)}">RETURN PARTS</button>
          </div>
        </article>
      `;
    }).join("") : `<p class="robot-service-notice">No robots yet. Buy one from the Robot Depot.</p>`;
    return `
      <section>
        <h2>YOUR ROBOTS</h2>
        ${cards}
        <details class="master-terminal-build">
          <summary>ASSEMBLE A ROBOT FROM YOUR PARTS</summary>
          ${this.drawBuildForm()}
        </details>
      </section>
    `;
  }

  drawBuildForm() {
    const inventory = this.gameState.robotService;
    const choices = (parts) => parts.filter(({ id }) =>
      inventory.partCount(id) > 0 && isRobotPartUnlocked(id, this.gameState.reputation.shopLevel));
    const select = (name, label, options, optional = false) => `
      <label>${label}
        <select data-build-${name}>
          ${optional ? `<option value="">None</option>` : ""}
          ${options.map((part) => `<option value="${escapeHTML(part.id)}">${escapeHTML(part.name)} (${inventory.partCount(part.id)})</option>`).join("")}
        </select>
      </label>
    `;
    const frames = choices(ROBOT_PARTS.frames);
    const cells = choices(ROBOT_PARTS.cells);
    const boards = choices(ROBOT_PARTS.boards);
    const hasLogicBoard = boards.some(({ id }) =>
      ROBOT_PARTS.boards.find((part) => part.id === id)?.kind === "prefab");
    return `
      <form class="master-terminal-build-form">
        <label>Robot name<input type="text" data-build-name maxlength="30" required></label>
        ${select("frame", "Frame", frames)}
        ${select("cell", "Power cell", cells)}
        ${select("board", "Board 1", boards)}
        ${select("board", "Board 2", boards, true)}
        ${select("board", "Board 3", boards, true)}
        <button type="submit" data-assemble-robot ${frames.length && cells.length && hasLogicBoard ? "" : "disabled"}>ASSEMBLE</button>
      </form>
    `;
  }

  drawDepot(atCapacity) {
    return `
      <section>
        <h2>READY-TO-WORK ROBOTS</h2>
        ${atCapacity ? `<p class="robot-service-notice">Your Master Computer is full. Upgrade it to run another robot.</p>` : ""}
        ${PREBUILT_ROBOTS.map((robot) => `
          <article class="master-terminal-card">
            <div>
              <h2>${escapeHTML(robot.name)}</h2>
              <p>${escapeHTML(robot.description)}</p>
              <p>${escapeHTML([
                getRobotPart(robot.frame)?.name ?? robot.frame,
                ...robot.boards.map((id) => getRobotPart(id)?.name ?? id),
                getRobotPart(robot.cell)?.name ?? robot.cell,
              ].join(" · "))}</p>
            </div>
            <div class="master-terminal-buy">
              <strong>${money(robot.price)}</strong>
              <label>Name this robot<input type="text" maxlength="30" data-robot-name="${escapeHTML(robot.id)}"></label>
              <button type="button" data-buy-robot="${escapeHTML(robot.id)}" ${atCapacity ? "disabled" : ""}>BUY</button>
            </div>
          </article>
        `).join("")}
      </section>
    `;
  }

  drawParts() {
    const shopLevel = this.gameState.reputation.shopLevel;
    return `
      <section>
        <h2>ROBOT PARTS</h2>
        ${ROBOT_PART_GROUPS.map(({ id, label }) => `
          <h3>${escapeHTML(label)}</h3>
          <div class="master-terminal-parts">
            ${ROBOT_PART_CATALOG.filter((part) => part.category === id).map((part) => {
              const unlocked = isRobotPartUnlocked(part.id, shopLevel);
              return `
                <article class="master-terminal-part">
                  <div><strong>${escapeHTML(part.name)}</strong><span>Owned: ${this.gameState.robotService.partCount(part.id)}</span></div>
                  <div><span>${money(part.price)}</span>
                    <button type="button" data-buy-part="${escapeHTML(part.id)}" ${unlocked ? "" : "disabled"}>
                      ${unlocked ? "BUY" : `LEVEL ${part.level}`}
                    </button>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        `).join("")}
      </section>
    `;
  }

  handleTerminalClick(event) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (!button || !this.terminalWindow.element.contains(button)) return;
    if (button.dataset.terminalTab) {
      this.terminalTab = button.dataset.terminalTab;
      this.renderTerminal();
    } else if (button.dataset.buyRobot) {
      const name = this.terminalContent.querySelector(`[data-robot-name="${button.dataset.buyRobot}"]`)?.value;
      this.system.buyPrebuiltRobot(button.dataset.buyRobot, name);
    } else if (button.dataset.buyPart) this.system.buyPart(button.dataset.buyPart);
    else if (button.dataset.robotShift) {
      this.system.setOnShift(button.dataset.robotShift, button.dataset.onShift === "true");
    } else if (button.dataset.robotRecharge) this.system.recharge(button.dataset.robotRecharge);
    else if (button.dataset.robotDismantle) this.system.dismantle(button.dataset.robotDismantle);
  }

  handleTerminalSubmit(event) {
    if (!(event.target instanceof HTMLFormElement) || !event.target.matches(".master-terminal-build-form")) return;
    event.preventDefault();
    const form = event.target;
    this.system.assemble({
      name: form.querySelector("[data-build-name]").value,
      frame: form.querySelector("[data-build-frame]").value,
      cell: form.querySelector("[data-build-cell]").value,
      boards: [...form.querySelectorAll("[data-build-board]")].map((select) => select.value),
    });
  }

  destroy() {
    this.unregisterInteractions?.();
    this.terminalWindow.close();
    this.terminalWindow.element.remove?.();
    this.scene.windowManager.windows?.delete(this.terminalWindow.id);
  }
}
