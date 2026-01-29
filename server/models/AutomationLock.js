// server/models/AutomationLock.js
import mongoose from "mongoose";

const AutomationLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    lockedBy: { type: String, default: "" },
    runningUntil: { type: Date, default: null, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("AutomationLock", AutomationLockSchema);
