export const EMPLOYEE_JOBS = Object.freeze([
  { id: "register", label: "Run register" },
  { id: "stock_shelves", label: "Stock shelves" },
  { id: "clean", label: "Clean up trash" },
]);

export const EMPLOYEE_JOB_IDS = Object.freeze(EMPLOYEE_JOBS.map(({ id }) => id));
