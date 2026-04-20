const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authMiddleware");
const { lookupUser } = require("../controllers/userController");
const { updateName } = require("../controllers/userController");

router.patch("/update-name", authenticate, updateName);

router.get("/lookup", authenticate, lookupUser);

module.exports = router;