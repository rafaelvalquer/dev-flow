import mongoose from "mongoose";

const UraVersionSchema = new mongoose.Schema(
  {
    uraId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ura",
      required: true,
      index: true,
    },
    version: { type: String, trim: true, required: true },
    deploymentDate: { type: Date, required: true, index: true },
    developer: { type: String, trim: true, default: "" },
    ticket: { type: String, trim: true, default: "" },
    jiraSnapshot: { type: Object, default: {} },
    evidences: { type: [Object], default: [] },
    description: { type: String, trim: true, default: "" },
    changes: { type: [String], default: [] },
    scripts: { type: [String], default: [] },
    status: {
      type: String,
      trim: true,
      enum: ["planned", "deployed", "rollback", "cancelled"],
      default: "deployed",
      index: true,
    },
    deploymentStatusUpdatedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

UraVersionSchema.index({ uraId: 1, deploymentDate: -1 });
UraVersionSchema.index({ uraId: 1, version: 1 }, { unique: true });

export default mongoose.models.UraVersion ||
  mongoose.model("UraVersion", UraVersionSchema);
