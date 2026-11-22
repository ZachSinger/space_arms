import { UIWindow } from "./UIWindow.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { validateShopSave } from "./ShopSave.js";
import { sendBugReport, validateBugReport } from "./BugReport.js";
import { createDebugSnapshot } from "../debug/DebugInfo.js";
import { getSavedCursorMode } from "./GameCursor.js";
import { getBindings } from "../input/KeyBindings.js";
import { getControllerLabelStyle, getInputDevice, getResolvedControllerLabelStyle } from "../input/InputDevice.js";
import { database } from "../scenes/boot.js";

export class PauseMenu {
  constructor(shop) {
    this.shop = shop;
    this.destroying = false;
    this.inertBackground = [];
    this.shade = document.createElement("div");
    this.shade.className = "pause-shade hidden";
    document.getElementById("ui-layer").appendChild(this.shade);
    this.uiWindow = new UIWindow({
      id: "pause-menu", title: "PAUSED", width: "360px", height: "auto",
      onClose: () => this.resume(),
      contentHTML: `
        <div class="pause-actions">
          <button class="action-btn" data-pause-action="resume" data-pad-autofocus>Resume</button>
          <button class="action-btn" data-pause-action="save">Save Game</button>
          <button class="action-btn" data-pause-action="load">Load Game</button>
          <button class="action-btn" data-pause-action="settings">Settings</button>
          <button class="action-btn" data-pause-action="bug-report">Report a Problem</button>
          <button class="action-btn" data-pause-action="menu">Exit to Main Menu</button>
          <button class="action-btn" data-pause-action="desktop">Exit to Desktop</button>
        </div>
        <p class="pause-status" role="status"></p>`,
    }, shop.windowManager);
    this.settings = new SettingsPanel({
      onOpen: () => {
        this.uiWindow.element.classList.add("hidden");
        this.uiWindow.element.classList.remove("active");
      },
      onClose: () => {
        shop.managerTablet?.refreshHandbookPanel();
        if (!this.isOpen) return;
        this.uiWindow.element.classList.remove("hidden");
        shop.windowManager.focusWindow(this.uiWindow);
      },
    });
    this.confirmation = new UIWindow({
      id: "pause-confirmation", title: "CONFIRM", width: "400px", height: "auto",
      contentHTML: `<p data-pause-warning></p>
        <button class="action-btn" data-pause-confirm>Continue</button>
        <button class="action-btn" data-pause-cancel>Cancel</button>`,
    }, shop.windowManager);
    this.bugReport = new UIWindow({
      id: "bug-report-window", title: "REPORT A PROBLEM", width: "500px", height: "auto",
      contentHTML: `
        <div class="bug-report-form">
          <p>Your report includes the current game state, settings, recent controls, errors, and current save, plus a screenshot if selected. Nothing is sent until you press Send Report.</p>
          <label for="bug-report-title">Report title</label>
          <input id="bug-report-title" type="text" maxlength="200">
          <label for="bug-report-description">What happened?</label>
          <textarea id="bug-report-description" maxlength="4000" rows="6"></textarea>
          <label data-pad-row><input type="checkbox" data-bug-report-screenshot data-pad-a checked> Include a screenshot of the game window</label>
          <p class="bug-report-status" role="status" aria-live="polite"></p>
          <div class="bug-report-actions">
            <button class="action-btn" data-bug-report-send>Send Report</button>
            <button class="action-btn" data-bug-report-cancel>Cancel</button>
          </div>
        </div>`,
    }, shop.windowManager);
    this.bugReportTitle = this.bugReport.element.querySelector("#bug-report-title");
    this.bugReportDescription = this.bugReport.element.querySelector("#bug-report-description");
    this.bugReportScreenshot = this.bugReport.element.querySelector("[data-bug-report-screenshot]");
    this.bugReportScreenshot.disabled = !window.desktopApi?.sendBugReport;
    this.bugReportScreenshot.checked = !this.bugReportScreenshot.disabled;
    this.bugReportScreenshot.title = this.bugReportScreenshot.disabled
      ? "Screenshots are available in the desktop game." : "";
    this.bugReportStatus = this.bugReport.element.querySelector(".bug-report-status");
    this.bugReportSend = this.bugReport.element.querySelector("[data-bug-report-send]");
    this.bugReport.element.querySelector("[data-bug-report-send]")
      .addEventListener("click", () => void this.submitBugReport());
    this.bugReport.element.querySelector("[data-bug-report-cancel]")
      .addEventListener("click", () => this.bugReport.close());
    this.confirmation.element.querySelector("[data-pause-cancel]").addEventListener("click",
      () => this.confirmation.close());
    this.confirmation.element.querySelector("[data-pause-confirm]").addEventListener("click", () => {
      const action = this.confirmedAction;
      this.confirmation.close();
      void this.run(action);
    });
    this.uiWindow.element.addEventListener("click", (event) => {
      const action = event.target.closest("[data-pause-action]")?.dataset.pauseAction;
      if (action) void this.run(() => this.activate(action));
    });
  }

  get isOpen() { return this.uiWindow.isOpen; }

  get settingsOpen() { return !this.settings.element.classList.contains("hidden"); }

  toggle() {
    if (this.settingsOpen) return;
    if (this.confirmation.isOpen) {
      this.confirmation.close();
      return;
    }
    if (this.isOpen) this.uiWindow.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    this.uiWindow.openWindow();
    this.shade.classList.remove("hidden");
    const menuElements = [
      this.uiWindow.element, this.confirmation.element, this.bugReport.element,
      this.settings.element, this.shade,
    ];
    for (const element of document.getElementById("ui-layer").children) {
      if (menuElements.includes(element) || element.inert) continue;
      element.inert = true;
      this.inertBackground.push(element);
    }
    this.shop.setGamePaused(true);
    if (this.shop.shiftClock.started) {
      this.shop.shiftClock.isPaused = true;
      this.shop.shiftClock.notifyListeners();
    }
    const save = this.uiWindow.element.querySelector('[data-pause-action="save"]');
    save.disabled = !this.shop.saves.canWrite();
    const reason = this.shop.sandbox ? "Saving is unavailable in the test room."
      : "Finish the shift before saving.";
    save.title = save.disabled ? reason : "";
    this.uiWindow.element.querySelector('[data-pause-action="desktop"]').disabled = !window.desktopApi?.quitGame;
    this.status(save.disabled ? reason : "");
    this.uiWindow.element.querySelector('[data-pause-action="resume"]').focus();
    this.shop.controls.uiNavigator?.setHudOpen(false);
  }

  resume() {
    if (this.destroying) return;
    this.confirmation.close();
    this.bugReport.close();
    this.shade.classList.add("hidden");
    this.restoreBackground();
    this.shop.setGamePaused(false);
    if (this.shop.shiftClock.started) {
      this.shop.shiftClock.isPaused = false;
      this.shop.shiftClock.notifyListeners();
    }
  }

  status(message) {
    this.uiWindow.element.querySelector(".pause-status").textContent = message;
  }

  restoreBackground() {
    this.inertBackground.forEach((element) => { element.inert = false; });
    this.inertBackground = [];
  }

  async run(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      console.error("Pause menu action failed:", error);
      this.status(error.message);
    } finally {
      this.busy = false;
    }
  }

  confirm(message, action) {
    this.confirmedAction = action;
    this.confirmation.element.querySelector("[data-pause-warning]").textContent = message;
    this.confirmation.openWindow();
  }

  async activate(action) {
    if (action === "resume") this.uiWindow.close();
    else if (action === "bug-report") {
      this.bugReportStatus.textContent = "";
      this.bugReport.openWindow();
      this.bugReportTitle.focus();
    }
    else if (action === "save") {
      await this.shop.saves.saveManually();
      this.status(this.shop.saves.status);
    } else if (action === "settings") await this.settings.open();
    else if (action === "load") {
      this.confirm("Load your saved game? Unsaved progress will be lost.", async () => {
        const payload = await this.shop.saves.manager.read();
        if (!payload) throw new Error("No saved game was found.");
        const savedShopData = validateShopSave(payload.data.shop, database);
        this.shop.scene.restart({ savedShopData, real: this.shop.realMode });
      });
    } else if (action === "menu") {
      this.confirm("Exit to the main menu? Unsaved progress will be lost.", () => window.location.reload());
    } else if (action === "desktop") {
      this.confirm("Exit the game? Unsaved progress will be lost.", () => window.desktopApi.quitGame());
    } else {
      throw new RangeError(`Unknown pause menu action: ${action}`);
    }
  }

  async submitBugReport() {
    if (this.bugReportSend.disabled) return;
    this.bugReportSend.disabled = true;
    try {
      const report = {
        title: this.bugReportTitle.value,
        message: this.bugReportDescription.value,
        includeScreenshot: this.bugReportScreenshot.checked,
      };
      validateBugReport(report);
      this.bugReportStatus.textContent = "Sending report...";
      const customerIds = new Map(this.shop.customers.map((customer, index) => [customer, index + 1]));
      let display = null;
      let displayCaptureError = null;
      if (window.desktopApi?.getDisplaySettings) {
        try {
          display = await window.desktopApi.getDisplaySettings();
        } catch (error) {
          displayCaptureError = error.message;
        }
      }
      let saveFile = null;
      let saveCaptureError = null;
      try {
        saveFile = {
          version: 1,
          savedAt: Date.now(),
          data: { shop: this.shop.saves.serialize() },
        };
      } catch (error) {
        saveCaptureError = error.message;
      }
      let pendingErrors = [];
      let pendingErrorCaptureError = null;
      if (window.desktopApi?.getPendingRuntimeErrors) {
        try {
          pendingErrors = await window.desktopApi.getPendingRuntimeErrors();
        } catch (error) {
          pendingErrorCaptureError = error.message;
        }
      }
      const controllers = [...(window.navigator.getGamepads?.() ?? [])]
        .filter((pad) => pad && pad.connected !== false)
        .map((pad) => ({
          id: pad.id,
          mapping: pad.mapping,
          buttonCount: pad.buttons.length,
          axisCount: pad.axes.length,
          pressedButtons: pad.buttons.flatMap((button, index) => button.pressed ? [index] : []),
        }));
      report.sessionData = createDebugSnapshot(
        this.shop,
        (customer) => this.shop.debugInfo
          ? this.shop.debugInfo.identifyCustomer(customer) : customerIds.get(customer),
        this.shop.debugInfo?.recentEvents ?? this.shop.diagnostics?.events ?? [],
        window,
        {
          recentErrors: this.shop.diagnostics?.errors ?? [],
          pendingErrors,
          pendingErrorCaptureError,
          recentInputs: this.shop.diagnostics?.inputs ?? [],
          sessionDurationMs: this.shop.diagnostics
            ? Date.now() - this.shop.diagnostics.startedAt : null,
          settings: {
            keyboardBindings: getBindings(),
            textSize: SettingsPanel.getSavedTextSize(),
            cursor: getSavedCursorMode(),
            controllerLabelPreference: getControllerLabelStyle(),
            resolvedControllerLabelStyle: getResolvedControllerLabelStyle(),
            lastInputDevice: getInputDevice(),
          },
          controllers,
          display: displayCaptureError ? { captureError: displayCaptureError } : display,
          saveFile,
          saveCaptureError,
        },
      );
      if (window.desktopApi?.sendBugReport) await window.desktopApi.sendBugReport(report);
      else await sendBugReport(report);
      this.bugReportStatus.textContent = "Report sent. Thank you!";
      const pendingErrorIds = pendingErrors.map((error) => error.id).filter(Boolean);
      if (pendingErrorIds.length && window.desktopApi?.clearPendingRuntimeErrors) {
        try {
          await window.desktopApi.clearPendingRuntimeErrors(pendingErrorIds);
          window.dispatchEvent(new CustomEvent("runtime-errors-reported", {
            detail: pendingErrorIds,
          }));
        } catch (error) {
          console.error("Report sent, but saved errors could not be cleared:", error);
          this.bugReportStatus.textContent = "Report sent. Saved errors may be offered again next time.";
        }
      }
      this.bugReportTitle.value = "";
      this.bugReportDescription.value = "";
    } catch (error) {
      console.error("Could not send bug report:", error);
      this.bugReportStatus.textContent = `Report not sent: ${error.message} Your text has been kept.`;
    } finally {
      this.bugReportSend.disabled = false;
    }
  }

  destroy() {
    this.destroying = true;
    this.restoreBackground();
    this.shop.setGamePaused(false, { shutdown: true });
    this.settings.destroy();
    this.bugReport.close();
    this.shade.remove();
  }
}
