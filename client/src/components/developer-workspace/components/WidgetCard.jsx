import { Grip, MoreVertical } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WidgetCard({ title, icon: Icon, children }) {
  return (
    <Card className="developer-widget">
      <CardHeader className="developer-widget__header">
        <div className="developer-widget__header-main">
          <button
            type="button"
            className="developer-widget__drag"
            aria-label="Mover widget"
            title="Mover widget"
          >
            <Grip className="h-4 w-4" />
          </button>
          <CardTitle className="developer-widget__title">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
        </div>
        <button
          type="button"
          className="developer-widget__menu"
          aria-label="Opções do widget"
          title="Opções do widget"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="developer-widget__content">{children}</CardContent>
    </Card>
  );
}
