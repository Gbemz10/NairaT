const bcrypt = require("bcryptjs");
const pool = require("../database");
const jwt = require("jsonwebtoken");
const generateAccountNumber = require("../services/accountNumberGenerator");

const JWT_SECRET = process.env.JWT_SECRET;

const registerUser = async (req, res) => {

  const client = await pool.connect();

  try {

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Name, email and password are required"
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format"
      });
    }

    if (password.length < 7) {
      return res.status(400).json({
        error: "Password must be at least 7 characters"
      });
    }
let accountNumber;
let exists = true;

while (exists) {

  accountNumber = generateAccountNumber();

  const check = await pool.query(
    "SELECT id FROM users WHERE account_number = $1",
    [accountNumber]
  );

  if (check.rows.length === 0) {
    exists = false;
  }

}

    await client.query("BEGIN");

    const existingUser = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "Email already registered"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      "INSERT INTO users (email, password_hash, name, account_number) VALUES ($1,$2,$3,$4) RETURNING id",
      [email, hashedPassword, name, accountNumber]
    );

    const userId = userResult.rows[0].id;

    await client.query(
      "INSERT INTO wallets (user_id, balance_nairat) VALUES ($1,0)",
      [userId]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "User registered successfully",
      user_id: userId
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error("Registration error:", error);

    res.status(500).json({
      error: "Internal server error"
    });

  } finally {

    client.release();

  }

};

const loginUser = async (req, res) => {

  try {

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        field: "general",
        error: "Email and password are required"
      });
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        field: "email",
        error: "Email not registered"
      });
    }

    const user = userResult.rows[0];

    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        field: "password",
        error: "Incorrect password"
      });
    }

    const token = jwt.sign(
      { userId: user.id },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        account_number: user.account_number
      },
      message: "Login successful"
    });

  } catch (error) {

    console.error("Login error:", error);

    res.status(500).json({
      field: "server",
      error: "Internal server error"
    });

  }

};

module.exports = {
  registerUser,
  loginUser
};