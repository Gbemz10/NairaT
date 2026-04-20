const pool = require("../database");
const generateReference = require("../services/referenceGenerator");
const bcrypt = require("bcryptjs");

/**
 * GET WALLET
 */
const getWallet = async (req, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `
      SELECT 
        wallets.balance_nairat AS balance,
        users.account_number
      FROM wallets
      JOIN users ON wallets.user_id = users.id
      WHERE wallets.user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Wallet fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/**
 * DEPOSIT (MOCK / INTERNAL)
 */
const deposit = async (req, res) => {
  const userId = req.userId;
  const { amount, idempotency_key, pin } = req.body;

  if (!pin) {
    return res.status(400).json({ error: "Transaction PIN required" });
  }

  const pinResult = await pool.query(
    "SELECT transaction_pin_hash FROM users WHERE id = $1",
    [userId]
  );

  if (pinResult.rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const storedHash = pinResult.rows[0].transaction_pin_hash;

  if (!storedHash) {
    return res.status(400).json({ error: "Transaction PIN not set" });
  }

  const match = await bcrypt.compare(pin, storedHash);

  if (!match) {
    return res.status(401).json({ error: "Invalid transaction PIN" });
  }

  if (!idempotency_key) {
    return res.status(400).json({ error: "idempotency_key required" });
  }

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id FROM transactions WHERE idempotency_key = $1",
      [idempotency_key]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Duplicate transaction prevented" });
    }

    await client.query(
      "UPDATE wallets SET balance_nairat = balance_nairat + $1 WHERE user_id = $2",
      [amount, userId]
    );

    const reference = generateReference();

    await client.query(
      `INSERT INTO transactions
      (sender_id, receiver_id, amount, type, idempotency_key, reference, status)
      VALUES (NULL, $1, $2, 'deposit', $3, $4, 'success')`,
      [userId, amount, idempotency_key, reference]
    );

    await client.query("COMMIT");

    res.json({
      message: "Deposit successful",
      amount,
      reference,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Deposit error:", error);
    res.status(500).json({ error: "Deposit failed" });
  } finally {
    client.release();
  }
};

/**
 * WITHDRAW (NO MONNIFY — INTERNAL ONLY)
 */
const withdraw = async (req, res) => {
  const userId = req.userId;
  const { amount, pin } = req.body;

  const parsedAmount = Number(amount);

  if (!pin) {
    return res.status(400).json({ error: "Transaction PIN required" });
  }

  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const pinResult = await pool.query(
    "SELECT transaction_pin_hash FROM users WHERE id = $1",
    [userId]
  );

  if (pinResult.rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const storedHash = pinResult.rows[0].transaction_pin_hash;

  if (!storedHash) {
    return res.status(400).json({ error: "Transaction PIN not set" });
  }

  const match = await bcrypt.compare(pin, storedHash);

  if (!match) {
    return res.status(401).json({ error: "Invalid transaction PIN" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const wallet = await client.query(
      "SELECT balance_nairat FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );

    const balance = Number(wallet.rows[0].balance_nairat);

    if (balance < parsedAmount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const reference = generateReference();

    await client.query(
      `UPDATE wallets
       SET balance_nairat = balance_nairat - $1
       WHERE user_id = $2`,
      [parsedAmount, userId]
    );

    await client.query(
      `INSERT INTO transactions
      (sender_id, receiver_id, amount, type, reference, status)
      VALUES ($1, NULL, $2, 'withdrawal', $3, 'pending')`,
      [userId, parsedAmount, reference]
    );

    await client.query("COMMIT");

    res.json({
      message: "Withdrawal recorded (processing manually)",
      reference,
      amount: parsedAmount,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Withdraw error:", error);
    res.status(500).json({ error: "Withdrawal failed" });
  } finally {
    client.release();
  }
};

/**
 * TRANSFER (UNCHANGED)
 */
const transfer = async (req, res) => {
  const { identifier, pin } = req.body;
  const amount = Number(req.body.amount);
  const senderId = req.userId;

  if (!pin) {
    return res.status(400).json({ error: "Transaction PIN required" });
  }

  const pinResult = await pool.query(
    "SELECT transaction_pin_hash FROM users WHERE id=$1",
    [senderId]
  );

  const storedHash = pinResult.rows[0]?.transaction_pin_hash;

  if (!storedHash) {
    return res.status(400).json({ error: "Transaction PIN not set" });
  }

  const pinMatch = await bcrypt.compare(pin, storedHash);

  if (!pinMatch) {
    return res.status(401).json({ error: "Invalid transaction PIN" });
  }

  if (!identifier || !amount || amount <= 0) {
    return res.status(400).json({ error: "Identifier and valid amount required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const recipient = await client.query(
      `SELECT id FROM users
       WHERE email = $1 OR account_number = $1`,
      [identifier]
    );

    if (recipient.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    const receiverId = recipient.rows[0].id;

    const senderWallet = await client.query(
      `SELECT balance_nairat FROM wallets WHERE user_id = $1 FOR UPDATE`,
      [senderId]
    );

    const balance = Number(senderWallet.rows[0].balance_nairat);

    if (balance < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await client.query(
      `UPDATE wallets SET balance_nairat = balance_nairat - $1 WHERE user_id = $2`,
      [amount, senderId]
    );

    await client.query(
      `UPDATE wallets SET balance_nairat = balance_nairat + $1 WHERE user_id = $2`,
      [amount, receiverId]
    );

    const reference = generateReference();

    await client.query(
      `INSERT INTO transactions
      (sender_id, receiver_id, amount, type, reference, status)
      VALUES ($1,$2,$3,'transfer',$4,'success')`,
      [senderId, receiverId, amount, reference]
    );

    await client.query("COMMIT");

    res.json({
      message: "Transfer successful",
      reference,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Transfer error:", error);
    res.status(500).json({ error: "Transfer failed" });
  } finally {
    client.release();
  }
};

module.exports = {
  getWallet,
  deposit,
  withdraw,
  transfer,
};