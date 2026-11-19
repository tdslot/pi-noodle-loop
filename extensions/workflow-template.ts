/** Source template for the named workflow. Only one literal is substituted (JSON.stringify of a validated tasks array); task text is never interpolated raw. Items run sequentially: impl then review per item. */
export const NOODLE_WORKFLOW = `
const tasks = "__TASKS__";
const results = [];
for (const [i, t] of tasks.entries()) {
  const impl = await runs.run("impl" + i, { agent: "worker", task: t.impl });
  const review = await runs.run("review" + i, { agent: "reviewer", task: t.review });
  results.push({ impl: impl.output, review: review.output });
}
return results;
`;
