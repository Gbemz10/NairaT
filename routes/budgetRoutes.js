const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authMiddleware"); 

const {
  setBudget,
  deleteBudget,
  getBudgets,
} = require("../controllers/transactionController");

router.post("/set", authenticate, setBudget);        
router.delete("/:period", authenticate, deleteBudget); 
router.get("/", authenticate, getBudgets);          

module.exports = router;