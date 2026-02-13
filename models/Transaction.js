const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  userEmail: String,
  amount: Number,

  status: {
    type: String,
    default: "Requested"
  },

  category: {
    type: String,
    default: "Membership"
  },

  paymentMethod: {
    type: String,
    default: "UPI"
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Transaction", transactionSchema);

