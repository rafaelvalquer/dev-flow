// server/models/TicketHistory.js
import mongoose from "mongoose";

const TicketHistorySchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    action: { type: String, trim: true, required: true }, // ex: "status_change", "comment", "assign"
    from: { type: String, trim: true },
    to: { type: String, trim: true },
    message: { type: String, default: "" },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.models.TicketHistory ||
  mongoose.model("TicketHistory", TicketHistorySchema);
