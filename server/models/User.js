// server/models/User.js
import mongoose from "mongoose";

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
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
