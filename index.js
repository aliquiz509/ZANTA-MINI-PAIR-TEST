require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 8000;

/* ---------------- MONGODB CONNECT ---------------- */

const MONGODB_URL = process.env.MONGODB_URL;

if (!MONGODB_URL) {
  console.error("❌ MONGODB_URL is missing in environment variables!");
  process.exit(1);
}

mongoose.connect(MONGODB_URL)
.then(() => {
  console.log("✅ MongoDB Connected Successfully");
})
.catch((err) => {
  console.error("❌ MongoDB Connection Error:", err);
});


/* ---------------- MIDDLEWARE ---------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


/* ---------------- ROUTES ---------------- */

const pairRouter = require("./pair");
app.use("/code", pairRouter);


/* ---------------- HOME PAGE ---------------- */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});


/* ---------------- SERVER START ---------------- */

app.listen(PORT, () => {
  console.log(`🚀 DRINX-MD Web Server running on port ${PORT}`);
});
