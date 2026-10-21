import React from "react";
import ReactECharts from "echarts-for-react";

export default function ChartView({
  option,
  className,
  style,
  loading = false,
  notMerge = true,
  lazyUpdate = true,
  ...props
}) {
  return (
    <ReactECharts
      option={option || {}}
      className={className}
      style={style}
      showLoading={loading}
      notMerge={notMerge}
      lazyUpdate={lazyUpdate}
      {...props}
    />
  );
}
