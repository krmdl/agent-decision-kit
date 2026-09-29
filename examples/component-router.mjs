#!/usr/bin/env node
import { createProvider } from "../dist/providers/index.js";

const catalog = {
  metric_card: "Compact card with one numeric value, label, and optional trend indicator",
  notice: "Short informational or warning callout with a bounded severity",
  action_list: "List of up to three safe navigation or view actions",
};

const task = process.argv.slice(2).join(" ") || "Show a concise status summary";
const result = await createProvider().decide({
  state: { userRequest: task, catalog },
  questions: {
    component: {
      type: "choice",
      instructions: task,
      criteria: catalog,
    },
  },
});

const selected = result.answers.component;
if (selected?.type !== "choice" || !(selected.choice in catalog)) throw new Error("The component ID was outside the allowlisted catalog.");

// This is a typed component plan, not generated executable UI code.
process.stdout.write(`${JSON.stringify({
  component: selected.choice,
  description: catalog[selected.choice],
  confidence: selected.confidence,
  calibration: selected.calibration,
  renderer: "ordinary application code validates props and renders this ID",
}, null, 2)}\n`);
