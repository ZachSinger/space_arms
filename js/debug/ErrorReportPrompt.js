import { sendBugReport, validateBugReport } from "../logic/BugReport.js";

const MAX_REPORT_ERRORS = 20;

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/(?:[A-Za-z]:[\\/]|file:\/\/\/)[^\s)]+/g, (filePath) =>
      filePath.split(/[\\/]/).pop() || "<local file>")
    .slice(0, maxLength);
}

function errorText(error) {
  const message = error && typeof error === "object"
    ? error.message ?? error.reason : error;
  return safeText(message || "Unknown error", 2000);
}

function safeStack(stack) {
  return safeText(stack, 10000);
}

export function createErrorReportPrefill(errors) {
  const recent = errors.slice(-MAX_REPORT_ERRORS);
  const latest = recent[recent.length - 1];
  const title = `Game error: ${errorText(latest)}`.slice(0, 200);
  const details = recent.map((error, index) => {
    const time = error.at ? ` (${error.at})` : "";
    const stack = error.stack ? `\n${safeStack(error.stack)}` : "";
    return `${index + 1}. ${error.type || "runtime-error"}${time}\n${errorText(error)}${stack}`;
  }).join("\n\n");
  return {
    title,
    message: `The game encountered an error. Please describe what you were doing before it happened.\n\n${details}`
      .slice(0, 4000),
  };
}

export class ErrorReportPrompt {
  constructor(environment = window) {
    this.environment = environment;
    this.dialog = environment.document.getElementById("runtime-error-dialog");
    this.title = this.dialog.querySelector("[data-runtime-error-title]");
    this.message = this.dialog.querySelector("[data-runtime-error-message]");
    this.status = this.dialog.querySelector("[data-runtime-error-status]");
    this.sendButton = this.dialog.querySelector("[data-runtime-error-send]");
    this.dismissButton = this.dialog.querySelector("[data-runtime-error-dismiss]");
    this.errors = [];
    this.dismissed = false;
    this.prefill = { title: "", message: "" };
    this.localErrorNumber = 0;
    this.handleError = (event) => this.capture({
      type: "renderer-error",
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack,
    });
    this.handleRejection = (event) => this.capture({
      type: "unhandled-rejection",
      message: event.reason?.message ?? String(event.reason),
      stack: event.reason?.stack,
    });
    this.handleReported = (event) => {
      const reportedIds = new Set(event.detail ?? []);
      this.errors = this.errors.filter((error) => !reportedIds.has(error.id));
      if (this.errors.length === 0) this.dismissed = false;
    };
    this.handleSend = () => void this.submit();
    this.handleDismiss = () => {
      this.dismissed = true;
      this.dialog.close();
    };

    environment.addEventListener("error", this.handleError);
    environment.addEventListener("unhandledrejection", this.handleRejection);
    environment.addEventListener("runtime-errors-reported", this.handleReported);
    this.sendButton.addEventListener("click", this.handleSend);
    this.dismissButton.addEventListener("click", this.handleDismiss);
    void this.loadPending();
  }

  mergeErrors(errors) {
    const knownIds = new Set(this.errors.map((error) => error.id).filter(Boolean));
    this.errors.push(...errors.filter((error) =>
      (!error.id || !knownIds.has(error.id)) &&
      !this.errors.some((existing) => existing.localId && !error.localId &&
        existing.type === error.type && existing.message === error.message)));
    this.errors = this.errors.slice(-MAX_REPORT_ERRORS);
  }

  async loadPending() {
    if (!this.environment.desktopApi?.getPendingRuntimeErrors) return;
    try {
      this.mergeErrors(await this.environment.desktopApi.getPendingRuntimeErrors());
      if (this.errors.length) this.open();
    } catch (error) {
      console.error("Could not load saved game errors:", error);
      this.status.textContent = `Saved errors could not be loaded: ${error.message}`;
    }
  }

  capture(error) {
    const localId = `local-${Date.now()}-${this.localErrorNumber++}`;
    const record = {
      ...error,
      message: errorText(error),
      filename: safeText(error.filename, 500),
      stack: safeStack(error.stack),
      at: new Date().toISOString(),
      localId,
    };
    this.mergeErrors([record]);
    this.open();

    const save = this.environment.desktopApi?.recordRuntimeError;
    if (!save) return;
    Promise.resolve(save(record)).then((saved) => {
      this.errors = this.errors.map((entry) => entry.localId === localId ? saved : entry);
    }).catch((saveError) => {
      console.error("Could not save game error:", saveError);
      this.status.textContent = `The error could not be saved for later: ${saveError.message}`;
    });
  }

  open() {
    if (this.dismissed || this.errors.length === 0) return;
    const activeGame = this.environment.__game?.scene?.getScene?.("scene-game");
    try {
      if (activeGame?.pauseMenu && !activeGame.pauseMenu.isOpen) activeGame.pauseMenu.open();
    } catch (error) {
      console.error("Could not pause after a game error:", error);
    }
    const nextPrefill = createErrorReportPrefill(this.errors);
    if (!this.dialog.open || this.title.value === this.prefill.title) {
      this.title.value = nextPrefill.title;
    }
    if (!this.dialog.open || this.message.value === this.prefill.message) {
      this.message.value = nextPrefill.message;
    }
    this.prefill = nextPrefill;
    this.status.textContent = "Nothing is sent unless you choose Send Report.";
    if (!this.dialog.open) this.dialog.showModal();
  }

  async submit() {
    if (this.sendButton.disabled) return;
    this.sendButton.disabled = true;
    try {
      const report = {
        title: this.title.value,
        message: this.message.value,
        includeScreenshot: false,
        sessionData: { diagnostics: { pendingErrors: this.errors } },
      };
      validateBugReport(report);
      this.status.textContent = "Sending report...";
      if (this.environment.desktopApi?.sendBugReport) {
        await this.environment.desktopApi.sendBugReport(report);
      } else {
        await sendBugReport(report);
      }
      this.status.textContent = "Report sent. Thank you.";
      const ids = this.errors.map((error) => error.id).filter(Boolean);
      let cleared = true;
      if (ids.length && this.environment.desktopApi?.clearPendingRuntimeErrors) {
        try {
          await this.environment.desktopApi.clearPendingRuntimeErrors(ids);
        } catch (error) {
          console.error("Report sent, but saved errors could not be cleared:", error);
          this.status.textContent = "Report sent, but the saved error notice may appear again next time.";
          cleared = false;
        }
      }
      this.errors = cleared ? [] : this.errors;
      this.dismissed = !cleared;
      this.dialog.close();
    } catch (error) {
      console.error("Could not send error report:", error);
      this.status.textContent = `Report not sent: ${error.message} Your report has been kept.`;
    } finally {
      this.sendButton.disabled = false;
    }
  }

  destroy() {
    this.environment.removeEventListener("error", this.handleError);
    this.environment.removeEventListener("unhandledrejection", this.handleRejection);
    this.environment.removeEventListener("runtime-errors-reported", this.handleReported);
    this.sendButton.removeEventListener("click", this.handleSend);
    this.dismissButton.removeEventListener("click", this.handleDismiss);
  }
}
