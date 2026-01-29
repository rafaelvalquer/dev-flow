// server/routes/automation.js
import express from "express";
import Ticket from "../models/Ticket.js";
import { createJiraClient } from "./jira.routes.js";
import { parseCronogramaADF } from "../utils/cronogramaParser.js";
import { evaluateRules, hasExecuted } from "../utils/automationEngine.js";

const router = express.Router();

function normTicketKey(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

// POST /api/automation/dry-run
router.post("/dry-run", async (req, res) => {
  try {
    const tk = normTicketKey(req.body?.ticketKey);
    const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];

    if (!tk) return res.status(400).json({ error: "ticketKey é obrigatório." });

    const ticket = await Ticket.findOne({ ticketKey: tk }).lean();
    if (!ticket)
      return res.status(404).json({ error: "Ticket não encontrado." });

    const jira = createJiraClient(process.env);

    const fieldId = process.env.JIRA_CRONOGRAMA_FIELD_ID || "customfield_14017";
    const issue = await jira.getIssue(tk, [
      "summary",
      "status",
      fieldId,
      "subtasks",
    ]);

    const cronADF = issue?.fields?.[fieldId] || null;
    const cronogramaAtividades = cronADF ? parseCronogramaADF(cronADF) : [];

    // kanban subtasks (do DB)
    const subtasks = [];
    const cfg = ticket?.kanban?.config || ticket?.data?.kanban?.config;
    const columns = cfg?.columns || {};
    for (const stepKey of Object.keys(columns)) {
      const col = columns[stepKey];
      for (const card of col?.cards || []) {
        for (const st of card?.subtasks || []) {
          subtasks.push({
            id: st.id,
            stepKey,
            cardTitle: card.title || "",
            title: st.title || "",
            jiraKey: st.jiraKey || "",
            jiraStatus: st.jiraStatus || "",
            done: Boolean(st.done),
          });
        }
      }
    }

    const automation = {
      ...(ticket?.data?.automation || {}),
      rules,
    };

    const { fired } = evaluateRules({
      ticketKey: tk,
      issue,
      kanbanSubtasks: subtasks,
      cronogramaAtividades,
      automation,
    });

    return res.json({
      ticketKey: tk,
      wouldFire: fired.map((x) => ({
        ruleId: x.rule.id,
        name: x.rule.name,
        eventKey: x.eventKey,
        alreadyExecuted: hasExecuted(automation, x.eventKey),
        actions: x.rule.actions || [],
        varsPreview: x.vars,
      })),
    });
  } catch (err) {
    console.error("automation dry-run error:", err);
    return res
      .status(500)
      .json({ error: "Erro no dry-run", details: String(err?.message || err) });
  }
});

export default router;
