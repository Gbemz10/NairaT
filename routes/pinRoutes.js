const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authMiddleware");

const {
  checkPinExists,
  createPin,
  verifyPin
} = require("../controllers/pinController");


router.get("/exists", authenticate, checkPinExists);

router.post("/create", authenticate, createPin);

router.post("/verify", authenticate, verifyPin);

module.exports = router;