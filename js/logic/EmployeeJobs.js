export const EMPLOYEE_JOBS = Object.freeze([
  { id: "register", label: "Run register" },
  { id: "stock_shelves", label: "Stock shelves" },
]);

export const EMPLOYEE_JOB_IDS = Object.freeze(EMPLOYEE_JOBS.map(({ id }) => id));
