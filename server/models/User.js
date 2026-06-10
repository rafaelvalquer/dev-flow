// server/models/User.js
import mongoose from "mongoose";

const UserPreferencesSchema = new mongoose.Schema(
  {
    theme: { type: String, trim: true, default: "claro" },
    primaryColor: { type: String, trim: true, default: "#cf0013" },
    density: { type: String, trim: true, default: "comfortable" },
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
    jiraDisplayName: { type: String, trim: true, default: "" },
    jiraEmailAddress: { type: String, trim: true, default: "" },
    jiraAvatarUrl: { type: String, trim: true, default: "" },
    jiraUserUpdatedAt: { type: Date },
    jiraTokenUpdatedAt: { type: Date },
    lastLoginAt: { type: Date },
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({
        theme: "claro",
        primaryColor: "#cf0013",
        density: "comfortable",
        defaultTab: "gmud",
        sidebarCollapsed: false,
      }),
    },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
