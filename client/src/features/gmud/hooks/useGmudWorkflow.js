import { useMemo, useReducer } from "react";
import {
  GMUD_EVENTS,
  deriveGmudState,
  gmudMachine,
} from "../rules/gmudMachine";

function reducer(state, event) {
  return gmudMachine.transition(state, event);
}

export default function useGmudWorkflow(context) {
  const initial = useMemo(
    () => ({
      value: deriveGmudState(context),
      context,
    }),
    [context],
  );

  const [state, dispatch] = useReducer(reducer, initial);

  return {
    state: state.value,
    context: state.context,
    dispatch,
    events: GMUD_EVENTS,
  };
}
