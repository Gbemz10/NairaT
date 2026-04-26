const pool = require("../database");
const { mintTokens, burnTokens } = require("../services/blockchainService");
const generateReference = require("../services/referenceGenerator");
const bcrypt = require("bcryptjs");

/**
 * HELPER: Verify transaction PIN
 * Reused across deposit, withdraw, convert.
 */
const verifyPin = async (userId, pin) => {
  if (!pin) {
    return { ok: false, status: 400, error: "Transaction PIN required" };
  }

  const pinResult = await pool.query(
    "SELECT transaction_pin_hash FROM users WHERE id = $1",
    [userId]
  );

  if (pinResult.rows.length === 0) {
    return { ok: false, status: 404, error: "User not found" };
  }

  const storedHash = pinResult.rows[0].transaction_pin_hash;

  if (!storedHash) {
    return { ok: false, status: 400, error: "Transaction PIN not set" };
  }

  const match = await bcrypt.compare(pin, storedHash);

  if (!match) {
    return { ok: false, status: 401, error: "Invalid transaction PIN" };
  }

  return { ok: true };
};

/**
 * GET WALLET — returns BOTH balances now.
 */
const getWallet = async (req, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `
      SELECT 
        wallets.balance_nairat AS balance_nairat,
        wallets.balance_ngn AS balance_ngn,
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

    const row = result.rows[0];

    // Backwards-compatible: still expose `balance` as an alias for NairaT
    res.json({
      balance_ngn: row.balance_ngn,
      balance_nairat: row.balance_nairat,
      balance: row.balance_nairat, // legacy alias
      account_number: row.account_number,
    });
  } catch (error) {
    console.error("Wallet fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/**
 * DEPOSIT — adds to NGN balance (fiat in).
 * This is "I put Naira in" — nothing is tokenized yet.
 */
const deposit = async (req, res) => {
  const userId = req.userId;
  const { amount, idempotency_key, pin } = req.body;

  if (!idempotency_key) {
    return res.status(400).json({ error: "idempotency_key required" });
  }

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0" });
  }

  const pinCheck = await verifyPin(userId, pin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.status).json({ error: pinCheck.error });
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
      "UPDATE wallets SET balance_ngn = balance_ngn + $1 WHERE user_id = $2",
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
 * WITHDRAW — deducts from NGN balance (fiat out).
 * Users must convert NairaT back to NGN first if they want to withdraw.
 */
const withdraw = async (req, res) => {
  const userId = req.userId;
  const { amount, pin } = req.body;

  const parsedAmount = Number(amount);

  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const pinCheck = await verifyPin(userId, pin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.status).json({ error: pinCheck.error });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const wallet = await client.query(
      "SELECT balance_ngn FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );

    const balance = Number(wallet.rows[0].balance_ngn);

    if (balance < parsedAmount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient NGN balance" });
    }

    const reference = generateReference();

    await client.query(
      `UPDATE wallets
       SET balance_ngn = balance_ngn - $1
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
      message: "Withdrawal recorded",
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
 * CONVERT — NGN → NairaT (tokenization)
 * Locks NGN, mints equivalent NairaT. 1:1 rate.
 */
const convert = async (req, res) => {
  const userId = req.userId;
  const { amount, pin, direction, idempotency_key } = req.body;

  const parsedAmount = Number(amount);

  if (!idempotency_key) {
    return res.status(400).json({ error: "idempotency_key required" });
  }

  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  // direction: "to_nairat" (default) or "to_ngn"
  const dir = direction || "to_nairat";
  if (!["to_nairat", "to_ngn"].includes(dir)) {
    return res.status(400).json({ error: "Invalid direction" });
  }

  const pinCheck = await verifyPin(userId, pin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.status).json({ error: pinCheck.error });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Idempotency
    const existing = await client.query(
      "SELECT id FROM transactions WHERE idempotency_key = $1",
      [idempotency_key]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Duplicate transaction prevented" });
    }

    // Lock the wallet row for update
    const wallet = await client.query(
      "SELECT balance_ngn, balance_nairat FROM wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );

    if (wallet.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Wallet not found" });
    }

    const ngnBalance = Number(wallet.rows[0].balance_ngn);
    const nairatBalance = Number(wallet.rows[0].balance_nairat);

    if (dir === "to_nairat") {
      // NGN → NairaT (mint)
      if (ngnBalance < parsedAmount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Insufficient NGN balance" });
      }

      await client.query(
        `UPDATE wallets
         SET balance_ngn = balance_ngn - $1,
             balance_nairat = balance_nairat + $1
         WHERE user_id = $2`,
        [parsedAmount, userId]
      );
    } else {
      // NairaT → NGN (burn)
      if (nairatBalance < parsedAmount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Insufficient NairaT balance" });
      }

      await client.query(
        `UPDATE wallets
         SET balance_nairat = balance_nairat - $1,
             balance_ngn = balance_ngn + $1
         WHERE user_id = $2`,
        [parsedAmount, userId]
      );
    }

    const reference = generateReference();

    await client.query(
      `INSERT INTO transactions
      (sender_id, receiver_id, amount, type, idempotency_key, reference, status, description)
      VALUES ($1, $1, $2, 'conversion', $3, $4, 'success', $5)`,
      [
        userId,
        parsedAmount,
        idempotency_key,
        reference,
        dir === "to_nairat" ? "NGN to NairaT" : "NairaT to NGN",
      ]
    );

    await client.query("COMMIT");

    // Fire blockchain mint/burn after DB commit (non-blocking)
    
    if (dir === "to_nairat") {
      mintTokens(process.env.DEPLOYER_ADDRESS, parsedAmount)
        .then((r) => console.log("Mint tx:", r.txHash))
        .catch((e) => console.error("Mint failed:", e.message));
    } else {
      burnTokens(process.env.DEPLOYER_ADDRESS, parsedAmount)
        .then((r) => console.log("Burn tx:", r.txHash))
        .catch((e) => console.error("Burn failed:", e.message));
    }

    res.json({
      message: "Conversion successful",
      amount: parsedAmount,
      direction: dir,
      reference,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Convert error:", error);
    res.status(500).json({ error: "Conversion failed" });
  } finally {
    client.release();
  }
};

/**
 * TRANSFER — unchanged, still uses NairaT (tokenized P2P).
 */
const transfer = async (req, res) => {
  const { identifier, pin } = req.body;
  const amount = Number(req.body.amount);
  const senderId = req.userId;

  const pinCheck = await verifyPin(senderId, pin);
  if (!pinCheck.ok) {
    return res.status(pinCheck.status).json({ error: pinCheck.error });
  }

  if (!identifier || !amount || amount <= 0) {
    return res
      .status(400)
      .json({ error: "Identifier and valid amount required" });
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
      return res.status(400).json({ error: "Insufficient NairaT balance" });
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
  convert,
  transfer,
};