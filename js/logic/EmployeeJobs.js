export const EMPLOYEE_JOBS = Object.freeze([
  { id: "register", label: "Run register" },
  { id: "stock_shelves", label: "Stock shelves" },
  { id: "load_storage", label: "Load storage" },
]);

export const EMPLOYEE_JOB_IDS = Object.freeze(EMPLOYEE_JOBS.map(({ id }) => id));
