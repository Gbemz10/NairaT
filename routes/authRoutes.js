const express = require("express");
const router = express.Router();

const {
  initiateSignup,
  completeSignup,
  resendSignupOTP,
  loginUser,
} = require("../controllers/authController");

/**
 * @swagger
 * /api/auth/initiate-signup:
 *   post:
 *     summary: Step 1 of signup - validates input and sends OTP to email
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification code sent
 */
router.post("/initiate-signup", initiateSignup);

/**
 * @swagger
 * /api/auth/complete-signup:
 *   post:
 *     summary: Step 2 of signup - verifies OTP and creates the account
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               code:
 *                 type: string
 *     responses:
 *       201:
 *         description: Account created successfully
 */
router.post("/complete-signup", completeSignup);

/**
 * @swagger
 * /api/auth/resend-signup-otp:
 *   post:
 *     summary: Resend signup verification code
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Code resent
 */
router.post("/resend-signup-otp", resendSignupOTP);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post("/login", loginUser);

module.exports = router;