import { describe, expect, it } from "vitest";
import {
  GMUD_EVENTS,
  GMUD_STATES,
  canAdvanceStep,
  deriveGmudState,
  getStepProgress,
  gmudMachine,
} from "./gmudMachine";

const workflow = [
  { key: "dev", title: "Desenvolvimento" },
  { key: "deploy", title: "Deploy" },
];

function makeConfig(done = true) {
  return {
    workflow,
    columns: {
      dev: {
        cards: [
          {
            title: "Card",
            subtasks: [{ title: "Sub", jiraKey: "ABC-1", done }],
          },
        ],
      },
      deploy: {
        cards: [
          {
            title: "Deploy",
            subtasks: [{ title: "Implantar", jiraKey: "ABC-2", done }],
          },
        ],
      },
    },
  };
}

describe("gmudMachine", () => {
  it("derives draft without a kanban config", () => {
    expect(deriveGmudState({})).toBe(GMUD_STATES.DRAFT);
  });

  it("calculates step progress from local subtask completion", () => {
    expect(
      getStepProgress({ config: makeConfig(true), stepKey: "dev" }),
    ).toEqual({ done: 1, total: 1, pct: 100, complete: true });

    expect(
      getStepProgress({ config: makeConfig(false), stepKey: "dev" }).complete,
    ).toBe(false);
  });

  it("blocks advance when subtasks are pending", () => {
    const guard = canAdvanceStep({
      config: makeConfig(false),
      workflow,
      jiraCtx: { ticketKey: "ABC-0", projectId: "10000" },
    });

    expect(guard.ok).toBe(false);
    expect(guard.reason).toBe("pending_subtasks");
  });

  it("requires evidence for deploy-like steps", () => {
    const guard = canAdvanceStep({
      config: makeConfig(true),
      workflow,
      unlockedStepIdx: 1,
      jiraCtx: { ticketKey: "ABC-0", projectId: "10000" },
      evidenceCountsByStep: {},
    });

    expect(guard.ok).toBe(false);
    expect(guard.reason).toBe("missing_evidence");
  });

  it("moves to advancing only when guards pass", () => {
    const state = {
      value: GMUD_STATES.STEP_READY_TO_ADVANCE,
      context: {
        config: makeConfig(true),
        workflow,
        jiraCtx: { ticketKey: "ABC-0", projectId: "10000" },
      },
    };

    expect(
      gmudMachine.transition(state, { type: GMUD_EVENTS.REQUEST_ADVANCE }).value,
    ).toBe(GMUD_STATES.STEP_ADVANCING);
  });
});
