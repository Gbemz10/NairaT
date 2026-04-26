const pool = require("../database");
const bcrypt = require("bcryptjs");
const { sendOTP } = require("../services/emailService");

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const requestOTP = async (req, res) => {
  const { email, purpose = "verification" } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  if (!["verification", "reset"].includes(purpose)) {
    return res.status(400).json({ error: "Invalid purpose" });
  }
  try {
    if (purpose === "reset") {
      const user = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (user.rows.length === 0) {
        return res.status(404).json({ error: "Email not registered" });
      }
    }
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      "INSERT INTO otps (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)",
      [email, code, purpose, expiresAt]
    );
    const result = await sendOTP(email, code, purpose);
    if (!result.success) {
      return res.status(500).json({ error: "Could not send email" });
    }
    res.json({ message: "OTP sent" });
  } catch (err) {
    console.error("OTP request error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

const verifyOTP = async (req, res) => {
  const { email, code, purpose = "verification" } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: "Email and code required" });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM otps 
       WHERE email = $1 AND code = $2 AND purpose = $3 
       AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code, purpose]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }
    await pool.query("UPDATE otps SET used = TRUE WHERE id = $1", [result.rows[0].id]);
    res.json({ message: "OTP verified", verified: true });
  } catch (err) {
    console.error("OTP verify error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

const resetPassword = async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: "All fields required" });
  }
  if (newPassword.length < 7) {
    return res.status(400).json({ error: "Password must be at least 7 characters" });
  }
  try {
    const otp = await pool.query(
      `SELECT * FROM otps 
       WHERE email = $1 AND code = $2 AND purpose = 'reset' 
       AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );
    if (otp.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [
      hashedPassword,
      email,
    ]);
    await pool.query("UPDATE otps SET used = TRUE WHERE id = $1", [otp.rows[0].id]);
    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { requestOTP, verifyOTP, resetPassword };
