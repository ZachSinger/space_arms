export const BUG_REPORT_URL = "https://bug-reporter.zachsinger88.workers.dev";
export const BUG_REPORT_MAX_LENGTH = 4000;

export function validateBugReport({ title, message }) {
  if (typeof title !== "string" || !title.trim()) {
    throw new TypeError("Enter a title for the report.");
  }
  if (title.length > 200) {
    throw new RangeError("Report titles must be 200 characters or fewer.");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new TypeError("Describe what went wrong before sending the report.");
  }
  if (message.length > BUG_REPORT_MAX_LENGTH) {
    throw new RangeError(`Bug reports must be ${BUG_REPORT_MAX_LENGTH} characters or fewer.`);
  }
}

export async function sendBugReport({ title, message, screenshotBlob, sessionData }, fetchReport = fetch) {
  validateBugReport({ title, message });
  const form = new FormData();
  form.append("title", title.trim());
  form.append("message", message.trim());
  if (screenshotBlob) form.append("screenshot", screenshotBlob, "screenshot.png");
  if (sessionData) form.append("gameData", JSON.stringify(sessionData, null, 2));

  const response = await fetchReport(BUG_REPORT_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Bug report failed: ${response.status}`);
  return response.json();
}
