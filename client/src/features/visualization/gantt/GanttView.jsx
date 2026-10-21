import React from "react";
import { Gantt, ViewMode } from "@rsagiev/gantt-task-react-19";
import "@rsagiev/gantt-task-react-19/dist/index.css";

export { ViewMode };

export default function GanttView(props) {
  return <Gantt {...props} />;
}
