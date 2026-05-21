import mongoose from "mongoose";

const UraSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true, index: true },
    description: { type: String, trim: true, default: "" },
    project: { type: String, trim: true, default: "" },
    owner: { type: String, trim: true, default: "" },
    status: {
      type: String,
      trim: true,
      enum: ["active", "maintenance", "deprecated"],
      default: "active",
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export default mongoose.models.Ura || mongoose.model("Ura", UraSchema);
