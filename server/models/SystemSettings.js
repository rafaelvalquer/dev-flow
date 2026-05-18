import mongoose from "mongoose";

const HolidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, trim: true },
    name: { type: String, trim: true, default: "" },
    repeatYearly: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const CalendarSettingsSchema = new mongoose.Schema(
  {
    workingWeekdays: {
      type: [Number],
      default: () => [1, 2, 3, 4, 5],
    },
    holidays: {
      type: [HolidaySchema],
      default: () => [],
    },
  },
  { _id: false },
);

const SystemSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    calendar: {
      type: CalendarSettingsSchema,
      default: () => ({
        workingWeekdays: [1, 2, 3, 4, 5],
        holidays: [],
      }),
    },
    updatedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export default mongoose.models.SystemSettings ||
  mongoose.model("SystemSettings", SystemSettingsSchema);
