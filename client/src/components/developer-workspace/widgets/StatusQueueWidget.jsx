import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyWidgetText } from "../components/EmptyWidgetText";
import { getStatus } from "../utils/developerTicketUtils";

const PREFERRED_STATUS_ORDER = [
  "Para Dev",
  "Desenvolvimento",
  "Para Homolog.",
  "Homologacao",
  "Para Deploy",
];

function statusKey(status) {
  return String(status || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function truncateLabel(label, maxLength) {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, Math.max(1, maxLength - 1))}...`;
}

function useElementWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const node = ref.current;

    setWidth(node.getBoundingClientRect().width || 0);

    if (typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry?.contentRect?.width || 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function StatusQueueWidget({ rows }) {
  const [containerRef, width] = useElementWidth();
  const compact = width > 0 && width < 340;
  const labelMaxLength = compact ? 12 : 18;

  const data = useMemo(() => {
    const counts = new Map();

    (rows || []).forEach((issue) => {
      const label = String(getStatus(issue) || "").trim() || "Sem status";
      const key = statusKey(label);
      const current = counts.get(key);
      counts.set(key, {
        label: current?.label || label,
        count: (current?.count || 0) + 1,
      });
    });

    const preferredKeys = new Set(PREFERRED_STATUS_ORDER.map(statusKey));
    const preferredRows = PREFERRED_STATUS_ORDER.map((label) => ({
      label: counts.get(statusKey(label))?.label || label,
      count: counts.get(statusKey(label))?.count || 0,
    })).filter((item) => item.count > 0);

    const extraRows = Array.from(counts.entries())
      .filter(([key, item]) => item.count > 0 && !preferredKeys.has(key))
      .map(([, item]) => item)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));

    return [...preferredRows, ...extraRows].map((item) => ({
      ...item,
      shortLabel: truncateLabel(item.label, labelMaxLength),
    }));
  }, [labelMaxLength, rows]);

  if (!data.length) {
    return <EmptyWidgetText text="Sem tickets ativos por status." />;
  }

  return (
    <div className="developer-status-queue" ref={containerRef}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={150}
        minWidth={180}
        debounce={80}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{
            top: 10,
            right: compact ? 22 : 30,
            bottom: 8,
            left: compact ? 0 : 8,
          }}
          barCategoryGap={compact ? 9 : 12}
        >
          <XAxis
            type="number"
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 700 }}
          />
          <YAxis
            type="category"
            dataKey="shortLabel"
            width={compact ? 78 : 112}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#374151", fontSize: 11, fontWeight: 800 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(207, 0, 19, 0.06)" }}
            formatter={(value) => [value, "Tickets"]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ""}
            contentStyle={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
              color: "#111827",
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="#cf0013" radius={[0, 5, 5, 0]} maxBarSize={28}>
            <LabelList
              dataKey="count"
              position="right"
              fill="#111827"
              fontSize={11}
              fontWeight={850}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
