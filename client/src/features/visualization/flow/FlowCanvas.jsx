import React from "react";
import { ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export * from "@xyflow/react";

export default function FlowCanvas(props) {
  return <ReactFlow {...props} />;
}
