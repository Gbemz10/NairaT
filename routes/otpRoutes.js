const express = require("express");
const router = express.Router();
const { requestOTP, verifyOTP, resetPassword } = require("../controllers/otpController");

router.post("/request", requestOTP);
router.post("/verify", verifyOTP);
router.post("/reset-password", resetPassword);

module.exports = router;