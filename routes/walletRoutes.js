const express = require("express");
const router = express.Router();

const authenticate = require("../middleware/authMiddleware");

const {
  getWallet,
  deposit,
  withdraw,
  transfer,
} = require("../controllers/walletController");

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     summary: Get wallet balance
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance retrieved
 */
router.get("/", authenticate, getWallet);

/**
 * @swagger
 * /api/wallet/banks:
 *   get:
 *     summary: Get supported Nigerian banks from Monnify
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Bank list retrieved successfully
 */


/**
 * @swagger
 * /api/wallet/deposit:
 *   post:
 *     summary: Deposit funds into wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - idempotency_key
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 5000
 *               idempotency_key:
 *                 type: string
 *                 example: deposit_test_1
 *     responses:
 *       200:
 *         description: Deposit successful
 */
router.post("/deposit", authenticate, deposit);

/**
 * @swagger
 * /api/wallet/withdraw:
 *   post:
 *     summary: Withdraw funds from wallet to a real Nigerian bank account
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - pin
 *               - bankCode
 *               - bankName
 *               - accountNumber
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 1000
 *               pin:
 *                 type: string
 *                 example: "1234"
 *               bankCode:
 *                 type: string
 *                 example: "058"
 *               bankName:
 *                 type: string
 *                 example: "Guaranty Trust Bank"
 *               accountNumber:
 *                 type: string
 *                 example: "0123456789"
 *     responses:
 *       200:
 *         description: Withdrawal initiated successfully
 */
router.post("/withdraw", authenticate, withdraw);

/**
 * @swagger
 * /api/wallet/transfer:
 *   post:
 *     summary: Transfer funds to another Nairat user
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transfer successful
 */
router.post("/transfer", authenticate, transfer);

module.exports = router;