/** Source template for the named workflow. Resolve with JSON.stringify for every substituted literal; user task text is never interpolated raw. */
export const NOODLE_WORKFLOW = `
const impl = await runs.run("impl", { agent: "worker", task: "__IMPLEMENTATION_TASK__" });
const review = await runs.run("review", { agent: "reviewer", task: "__REVIEW_TASK__" });
return { impl: impl.output, review: review.output };
`;
