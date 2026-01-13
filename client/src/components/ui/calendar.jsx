import * as React from "react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

function Calendar({
  className,
  showOutsideDays = true,
  numberOfMonths = 1,
  ...props
}) {
  return (
    <DayPicker
      locale={ptBR}
      showOutsideDays={showOutsideDays}
      numberOfMonths={numberOfMonths}
      className={cn(className)}
      {...props}
    />
  );
}

export { Calendar };
