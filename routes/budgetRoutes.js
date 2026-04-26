const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authMiddleware");

const {
  setBudget,
  getBudgets,
  getOverrideStatus,
} = require("../controllers/transactionController");

router.post("/set", authenticate, setBudget);
router.get("/", authenticate, getBudgets);
router.get("/overrides", authenticate, getOverrideStatus);

module.exports = router;