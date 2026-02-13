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

  const totalOrders = await Transaction.countDocuments();

  const totalRevenueData = await Transaction.aggregate([
    { $group: { _id: null, total: { $sum: "$amount" } } }
  ]);

  const totalRevenue = totalRevenueData[0]?.total || 0;

  const pendingOrders = await Transaction.countDocuments({
    status: "Requested"
  });

  const monthlyData = await Transaction.aggregate([
    {
      $group: {
        _id: { $month: "$createdAt" },
        total: { $sum: "$amount" }
      }
    },
    { $sort: { "_id": 1 } }
  ]);
  const recentOrders = await Transaction.find()
  .sort({ createdAt: -1 })
  .limit(5);

const activeMembers = await User.countDocuments({
  membershipExpiry: { $gt: new Date() }
});
res.render("adminDashboard", {
  totalOrders,
  totalRevenue,
  pendingOrders,
  activeMembers,
  monthlyData,
  recentOrders   // 🔴 THIS MUST BE HERE
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

// If user already has active membership, extend from that date
const baseDate =
  user.membershipExpiry && user.membershipExpiry > new Date()
    ? new Date(user.membershipExpiry)
    : new Date();

baseDate.setMonth(baseDate.getMonth() + months);

user.membershipExpiry = baseDate;
user.membershipType = "Active";   // ⭐ Force correct status

await user.save();


    await user.save();

res.render("success", {
  title: "Membership Added Successfully",
  message: "The membership has been activated.",
  redirectUrl: "/dashboard",
  buttonText: "Go to Dashboard"
});


});


// ======================
// Update Membership Page (Admin Only)
// ======================

app.get("/updateMembership", isLoggedIn, isAdmin, (req, res) => {
    res.render("updateMembership");
});
app.post("/updateMembership", isLoggedIn, isAdmin, async (req, res) => {

  const { email, action } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    return res.send("User not found");
  }

  const today = new Date();

  if (action === "extend") {

    const baseDate = user.membershipExpiry && user.membershipExpiry > today
      ? new Date(user.membershipExpiry)
      : today;

    baseDate.setMonth(baseDate.getMonth() + 6);

    user.membershipExpiry = baseDate;
    user.membershipType = "Active";

  } else if (action === "cancel") {

    user.membershipExpiry = today;
    user.membershipType = "Expired";
  }

  await user.save();

  res.render("success", {
    title: "Membership Updated",
    message: `Membership has been ${action === "extend" ? "extended" : "cancelled"} successfully.`,
    redirectUrl: "/dashboard",
    buttonText: "Go to Dashboard"
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

  const search = req.query.search || "";
  const { startDate, endDate } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const skip = (page - 1) * limit;

  let query = {};

  if (req.session.user.role === "admin") {
    if (search) {
      query.userEmail = { $regex: search, $options: "i" };
    }
  } else {
    query.userEmail = req.session.user.email;
  }

if (startDate && endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // include full end day

  query.createdAt = {
    $gte: start,
    $lte: end
  };
}


  const total = await Transaction.countDocuments(query);

  const transactions = await Transaction.find(query)
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
console.log("Final Query:", query);
console.log("Total Documents:", total);

res.render("transactions", {
  transactions,
  currentPage: page,
  totalPages: Math.ceil(total / limit),
  user: req.session.user,
  request: req   // 👈 add this
});


});

app.post("/updateStatus/:id", isLoggedIn, isAdmin, async (req, res) => {

  await Transaction.findByIdAndUpdate(req.params.id, {
    status: req.body.status
  });

  res.redirect("/dashboard");
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
    amount,
    status: "Requested",
    category: "Membership",
    paymentMethod: "UPI"
  });

  await newTransaction.save();

res.render("success", {
  title: "Payment Successful",
  message: "Your transaction has been recorded successfully.",
  redirectUrl: "/userDashboard",
  buttonText: "Go to Dashboard"
});

});
// ===============================
// ADD USER (ADMIN ONLY)
// ===============================

// Show Add User Page
app.get("/addUser", isLoggedIn, isAdmin, (req, res) => {
  res.render("addUser");
});

// Handle Add User Form
app.post("/addUser", isLoggedIn, isAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.send("User already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = new User({
    name,
    email,
    password: hashedPassword,
    role
  });

  await newUser.save();
return res.render("success", {
  title: "User Created Successfully",
  message: "The new user has been added to the system.",
  redirectUrl: "/dashboard",
  buttonText: "Go to Dashboard"
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
