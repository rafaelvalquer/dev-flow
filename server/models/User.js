// server/models/User.js
import mongoose from "mongoose";

const UserPreferencesSchema = new mongoose.Schema(
  {
    theme: { type: String, trim: true, default: "claro" },
    defaultTab: { type: String, trim: true, default: "gmud" },
    sidebarCollapsed: { type: Boolean, default: false },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      unique: true,
    },
    passwordHash: { type: String, trim: true, default: "" },
    jiraApiToken: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "user" },
    jiraAccountId: { type: String, trim: true },
    jiraTokenUpdatedAt: { type: Date },
    lastLoginAt: { type: Date },
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({
        theme: "claro",
        defaultTab: "gmud",
        sidebarCollapsed: false,
      }),
    },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
