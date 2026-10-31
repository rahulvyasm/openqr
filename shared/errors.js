export const problem = (message, status = 400) =>
  Object.assign(new Error(message), { domain: true, status });
