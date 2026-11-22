import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_PENDING_ERRORS = 20;

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/(?:[A-Za-z]:[\\/]|file:\/\/\/)[^\s)]+/g, (filePath) =>
      filePath.split(/[\\/]/).pop() || "<local file>")
    .slice(0, maxLength);
}

export function normalizePendingError(error) {
  if (!error || typeof error !== "object") {
    throw new TypeError("Runtime error details must be an object.");
  }
  const message = safeText(error.message, 2000);
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    type: safeText(error.type || "runtime-error", 100),
    message: message || "Unknown runtime error",
    filename: safeText(error.filename, 500),
    line: Number.isFinite(error.line) ? error.line : null,
    column: Number.isFinite(error.column) ? error.column : null,
    stack: safeText(error.stack, 10000),
    reason: safeText(error.reason, 500),
    exitCode: Number.isFinite(error.exitCode) ? error.exitCode : null,
  };
}

export class PendingErrorStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    let raw;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) throw new TypeError("Saved runtime errors must be an array.");
    return records;
  }

  write(records) {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(records), "utf8");
    renameSync(temporaryPath, this.filePath);
  }

  append(error) {
    const record = normalizePendingError(error);
    const records = [...this.read(), record].slice(-MAX_PENDING_ERRORS);
    this.write(records);
    return record;
  }

  clear(ids) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      throw new TypeError("Runtime error IDs must be an array of strings.");
    }
    const idsToClear = new Set(ids);
    const remaining = this.read().filter((record) => !idsToClear.has(record.id));
    this.write(remaining);
    return remaining;
  }
}
