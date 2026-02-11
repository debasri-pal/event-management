const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");

const User = require("./models/User");
const Transaction = require("./models/Transaction");

const app = express();

// ======================
// MongoDB Connection
// ======================
mongoose.connect("mongodb://127.0.0.1:27017/eventDB")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// ======================
// Basic Middleware
// ======================
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: "secretkey",
  resave: false,
  saveUninitialized: false
}));

// ======================
// 🔐 Custom Middlewares
// ======================

function isLoggedIn(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

function isAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.send("Access Denied");
  }
  next();
}

function isUser(req, res, next) {
  if (!req.session.user || req.session.user.role !== "user") {
    return res.send("Access Denied");
  }
  next();
}

// Membership Expiry Auto Check
async function checkMembershipExpiry(req, res, next) {
  if (req.session.user) {
    const user = await User.findById(req.session.user._id);

    if (user.membershipExpiry && user.membershipExpiry < new Date()) {
      user.membershipType = "Expired";
      await user.save();
    }
  }
  next();
}

app.use(checkMembershipExpiry);

// ======================
// Routes
// ======================

// Login Page
app.get("/", (req, res) => {
  res.render("login");
});

// Login Logic
app.post("/login", async (req, res) => {

  const { email, password } = req.body;

  if (!email || !password)
    return res.send("All fields are required.");

  const user = await User.findOne({ email });
  if (!user)
    return res.send("User not found.");

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.send("Incorrect password.");

  req.session.user = user;

  if (user.role === "admin")
    return res.redirect("/dashboard");
  else
    return res.redirect("/userDashboard");
});

// ======================
// Dashboards
// ======================

// Admin Dashboard
app.get("/dashboard", isLoggedIn, isAdmin, async (req, res) => {

  const totalTransactions = await Transaction.countDocuments();

  const totalAmountData = await Transaction.aggregate([
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);

  const totalAmount = totalAmountData[0]?.total || 0;

  const activeMembers = await User.countDocuments({
    membershipExpiry: { $gt: new Date() }
  });

  res.render("adminDashboard", {
    totalTransactions,
    totalAmount,
    activeMembers
  });
});

// User Dashboard
app.get("/userDashboard", isLoggedIn, isUser, (req, res) => {
  res.render("userDashboard");
});

// ======================
// Maintenance (Admin Only)
// ======================

app.get("/maintenance", isLoggedIn, isAdmin, (req, res) => {

  res.render("maintenance");
});

app.get("/addMembership", isLoggedIn, isAdmin, (req, res) => {
  res.render("addMembership");
});

app.post("/addMembership", isLoggedIn, isAdmin, async (req, res) => {

    const { email, duration, agree } = req.body;

    if (!email || !duration) {
        return res.send("All fields are mandatory.");
    }

    if (!agree) {
        return res.send("You must confirm membership activation.");
    }

    const user = await User.findOne({ email });
    if (!user) return res.send("User not found");

    const months = parseInt(duration);

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + months);

    user.membershipType = months + " months";
    user.membershipExpiry = expiry;

    await user.save();

    res.render("success", {
        message: "Membership Added Successfully 🎉",
        subMessage: "The membership has been activated."
    });

});


// ======================
// Reports (Admin Only)
// ======================

app.get("/reports", isLoggedIn, isAdmin, async (req, res) => {


  const totalUsers = await User.countDocuments();
  const activeMembers = await User.countDocuments({
    membershipExpiry: { $gt: new Date() }
  });

  res.render("reports", {
    totalUsers,
    activeMembers
  });
});

// ======================
// ======================
// Transactions
// ======================

app.get("/transactions", isLoggedIn, async (req, res) => {

  try {

    let transactions;

    if (req.session.user.role === "admin") {
      // Admin sees all transactions
      transactions = await Transaction.find().sort({ createdAt: -1 });
    } else {
      // User sees only their own transactions
      transactions = await Transaction.find({
        userEmail: req.session.user.email
      }).sort({ createdAt: -1 });
    }

    res.render("transactions", {
      transactions,
      user: req.session.user
    });

  } catch (error) {
    console.log(error);
    res.send("Error loading transactions");
  }

});
//Add Flow Chart Link on All Pages
app.get("/flowchart", isLoggedIn, (req, res) => {
    res.render("flowchart");
});

// ======================
// Payments (User Only)
// ======================

app.get("/makePayment", isLoggedIn, isUser, (req, res) => {

  res.render("makePayment");
});

app.post("/makePayment", isLoggedIn, isUser, async (req, res) => {

  const { amount } = req.body;

  if (!amount || amount <= 0)
    return res.send("Enter valid amount.");

  const newTransaction = new Transaction({
    userEmail: req.session.user.email,
    amount
  });

  await newTransaction.save();

  res.render("success", {
    message: "Payment Successful 💳",
    subMessage: "Transaction recorded."
  });
});

// ======================
// Forgot Password
// ======================

app.get("/forgot-password", (req, res) => {
  res.render("forgotPassword");
});

app.post("/forgot-password", async (req, res) => {

  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.send("Email not registered");

  res.render("resetPassword", { email: user.email });
});

app.post("/reset-password", async (req, res) => {

  const hashed = await bcrypt.hash(req.body.password, 10);

  await User.updateOne(
    { email: req.body.email },
    { password: hashed }
  );

  res.send("Password Updated Successfully <br><a href='/'>Login Now</a>");
});

// ======================
// Logout
// ======================

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ======================
// Start Server
// ======================

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
