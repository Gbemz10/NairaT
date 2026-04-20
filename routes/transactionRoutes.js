const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authMiddleware");

const {
  transfer,
  getTransactionHistory
} = require("../controllers/transactionController");

/**
 * @swagger
 * /api/transactions/transfer:
 *   post:
 *     summary: Transfer funds to another user
 *     tags: [Transactions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - receiver_id
 *               - amount
 *               - idempotency_key
 *             properties:
 *               receiver_id:
 *                 type: integer
 *                 example: 2
 *               amount:
 *                 type: number
 *                 example: 1500
 *               idempotency_key:
 *                 type: string
 *                 example: transfer_test_1
 *     responses:
 *       200:
 *         description: Transfer successful
 */
router.post("/transfer", authenticate, transfer);
/**
 * @swagger
 * /api/transactions/history:
 *   get:
 *     summary: Get transaction history
 *     tags: [Transactions]
 *     responses:
 *       200:
 *         description: Transaction history retrieved
 */
router.get("/history", authenticate, getTransactionHistory);

module.exports = router;