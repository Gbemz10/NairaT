const bcrypt = require("bcryptjs");
const pool = require("../database");
const jwt = require("jsonwebtoken");
const generateAccountNumber = require("../services/accountNumberGenerator");
const { sendOTP } = require("../services/emailService");

const JWT_SECRET = process.env.JWT_SECRET;

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/**
 * PHASE 1 — Validate signup, store pending, send OTP.
 * Does NOT create the user yet.
 */
const initiateSignup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Name, email and password are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (password.length < 7) {
      return res
        .status(400)
        .json({ error: "Password must be at least 7 characters" });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Upsert pending signup (in case they retry)
    await pool.query(
      `INSERT INTO pending_signups (email, name, password_hash, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           created_at = NOW()`,
      [email, name, hashedPassword]
    );

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      "INSERT INTO otps (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)",
      [email, code, "signup", expiresAt]
    );

    const result = await sendOTP(email, code, "verification");
    if (!result.success) {
      return res.status(500).json({ error: "Could not send verification email" });
    }

    res.json({ message: "Verification code sent" });
  } catch (error) {
    console.error("Initiate signup error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PHASE 2 — Verify OTP, create the user + wallet.
 */
const completeSignup = async (req, res) => {
  const client = await pool.connect();

  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email and code required" });
    }

    // Verify OTP
    const otpResult = await client.query(
      `SELECT * FROM otps
       WHERE email = $1 AND code = $2 AND purpose = 'signup'
       AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Get pending signup
    const pending = await client.query(
      "SELECT name, password_hash FROM pending_signups WHERE email = $1",
      [email]
    );

    if (pending.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Signup session expired. Please start again." });
    }

    const { name, password_hash } = pending.rows[0];

    // Generate unique account number
    let accountNumber;
    let exists = true;
    while (exists) {
      accountNumber = generateAccountNumber();
      const check = await client.query(
        "SELECT id FROM users WHERE account_number = $1",
        [accountNumber]
      );
      if (check.rows.length === 0) exists = false;
    }

    await client.query("BEGIN");

    // Create user
    const userResult = await client.query(
      "INSERT INTO users (email, password_hash, name, account_number) VALUES ($1, $2, $3, $4) RETURNING id",
      [email, password_hash, name, accountNumber]
    );

    const userId = userResult.rows[0].id;

    // Create wallet
    await client.query(
      "INSERT INTO wallets (user_id, balance_ngn, balance_nairat) VALUES ($1, 0, 0)",
      [userId]
    );

    // Mark OTP as used
    await client.query("UPDATE otps SET used = TRUE WHERE id = $1", [
      otpResult.rows[0].id,
    ]);

    // Clean up pending signup
    await client.query("DELETE FROM pending_signups WHERE email = $1", [email]);

    await client.query("COMMIT");

    res.status(201).json({
      message: "Account created successfully",
      user_id: userId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Complete signup error:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};

/**
 * Resend signup OTP — for the "Resend code" button.
 */
const resendSignupOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Email required" });

    const pending = await pool.query(
      "SELECT email FROM pending_signups WHERE email = $1",
      [email]
    );

    if (pending.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Signup session expired. Please start again." });
    }

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      "INSERT INTO otps (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)",
      [email, code, "signup", expiresAt]
    );

    const result = await sendOTP(email, code, "verification");
    if (!result.success) {
      return res.status(500).json({ error: "Could not send email" });
    }

    res.json({ message: "Code resent" });
  } catch (error) {
    console.error("Resend signup OTP error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ field: "general", error: "Email and password are required" });
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res
        .status(401)
        .json({ field: "email", error: "Email not registered" });
    }

    const user = userResult.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res
        .status(401)
        .json({ field: "password", error: "Incorrect password" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        account_number: user.account_number,
      },
      message: "Login successful",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ field: "server", error: "Internal server error" });
  }
};

module.exports = {
  initiateSignup,
  completeSignup,
  resendSignupOTP,
  loginUser,
};