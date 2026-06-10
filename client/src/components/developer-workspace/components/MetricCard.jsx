import { MoreVertical } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({ icon: Icon, label, value, helper, tone = "neutral" }) {
  return (
    <Card className={cn("developer-metric", `developer-metric--${tone}`)}>
      <CardContent className="p-4">
        <div className="developer-metric__icon">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <strong>{value}</strong>
          <span>{label}</span>
          {helper ? <small>{helper}</small> : null}
        </div>
        <MoreVertical className="developer-metric__menu h-4 w-4" />
      </CardContent>
    </Card>
  );
}

