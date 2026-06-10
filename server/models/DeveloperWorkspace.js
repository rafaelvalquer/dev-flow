import mongoose from "mongoose";

const DeveloperRecentTicketSchema = new mongoose.Schema(
  {
    ticketKey: { type: String, trim: true, uppercase: true, required: true },
    summary: { type: String, trim: true, default: "" },
    status: { type: String, trim: true, default: "" },
    priority: { type: String, trim: true, default: "" },
    activeTab: { type: String, trim: true, default: "" },
    progress: { type: Number, default: 0 },
    accessedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DeveloperStickyNoteSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, required: true },
    ticketKey: { type: String, trim: true, uppercase: true, default: "" },
    title: { type: String, trim: true, default: "" },
    text: { type: String, default: "" },
    color: { type: String, trim: true, default: "yellow" },
    pinned: { type: Boolean, default: false },
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    jiraCommentedAt: { type: Date, default: null },
    jiraCommentId: { type: String, trim: true, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DeveloperWorkspaceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    preferences: {
      visibleWidgets: {
        type: [String],
        default: () => [
          "queue",
          "statusQueue",
          "daily",
          "nextActions",
          "risk",
          "calendar",
          "recent",
          "notes",
          "productivity",
        ],
      },
      density: { type: String, trim: true, default: "comfortable" },
      sortBy: { type: String, trim: true, default: "dueDate" },
      startMode: { type: String, trim: true, default: "workspace" },
      autoSyncOnOpen: { type: Boolean, default: true },
    },
    layout: { type: Object, default: {} },
    recentTickets: {
      type: [DeveloperRecentTicketSchema],
      default: [],
    },
    stickyNotes: {
      type: [DeveloperStickyNoteSchema],
      default: [],
    },
    notesByTicket: {
      type: Map,
      of: {
        text: { type: String, default: "" },
        updatedAt: { type: Date, default: Date.now },
      },
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.models.DeveloperWorkspace ||
  mongoose.model("DeveloperWorkspace", DeveloperWorkspaceSchema);
