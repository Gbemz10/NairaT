const pool = require("../database");
const bcrypt = require("bcryptjs");
const generateReference = require("../services/referenceGenerator");



const checkBudget = async (client, userId, amount) => {
  const budgets = await client.query(
    `SELECT period, amount FROM budgets WHERE user_id = $1`,
    [userId]
  );

  for (const b of budgets.rows) {
    let condition = "";

 if (b.period === "daily") {
  condition = "DATE(created_at) = CURRENT_DATE";
} else if (b.period === "weekly") {
  condition = "created_at >= NOW() - INTERVAL '7 days'";
} else if (b.period === "monthly") {
  condition = "created_at >= date_trunc('month', NOW())";
}

    const spentRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE sender_id = $1
       AND type = 'transfer'
       AND ${condition}`,
      [userId]
    );

    const spent = Number(spentRes.rows[0].total);

    if (spent + amount > Number(b.amount)) {
      return {
        exceeded: true,
        period: b.period,
      };
    }
  }

  return { exceeded: false };
};


// ✅ TRANSFER
const transfer = async (req, res) => {
  const senderId = req.userId;
  const { receiver_id, amount, idempotency_key, pin, category } = req.body;

  if (!receiver_id || !amount || !pin || !idempotency_key) {
    return res.status(400).json({
      error: "receiver_id, amount, pin and idempotency_key required",
    });
  }

  if (amount <= 0) {
    return res.status(400).json({
      error: "Amount must be greater than 0",
    });
  }

  const allowedCategories = [
    "food",
    "transport",
    "shopping",
    "bills",
    "entertainment",
    "general"
  ];

  if (category && !allowedCategories.includes(category)) {
    return res.status(400).json({
      error: "Invalid category",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔍 Find receiver
    const userLookup = await client.query(
      "SELECT id FROM users WHERE account_number = $1",
      [receiver_id]
    );

    if (!userLookup.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Receiver not found" });
    }

    const realReceiverId = userLookup.rows[0].id;

    if (realReceiverId === senderId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }

    // 🔐 VERIFY PIN
    const userRes = await client.query(
      "SELECT transaction_pin_hash FROM users WHERE id = $1",
      [senderId]
    );

    if (!userRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    const storedHash = userRes.rows[0].transaction_pin_hash;

    if (!storedHash) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Transaction PIN not set" });
    }

    const isValidPin = await bcrypt.compare(pin, storedHash);

    if (!isValidPin) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Invalid PIN" });
    }

    // 💰 BUDGET CHECK
    const budgetCheck = await checkBudget(client, senderId, amount);

    if (budgetCheck.exceeded) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "BUDGET_EXCEEDED",
        period: budgetCheck.period,
      });
    }

    // 🔁 IDEMPOTENCY CHECK
    const existing = await client.query(
      "SELECT id FROM transactions WHERE idempotency_key = $1",
      [idempotency_key]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Duplicate transaction prevented",
      });
    }

    // 🔒 LOCK WALLETS
    const senderWallet = await client.query(
      "SELECT balance_nairat FROM wallets WHERE user_id = $1 FOR UPDATE",
      [senderId]
    );

    const receiverWallet = await client.query(
      "SELECT balance_nairat FROM wallets WHERE user_id = $1 FOR UPDATE",
      [realReceiverId]
    );

    if (!receiverWallet.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Receiver wallet not found",
      });
    }

    const balance = senderWallet.rows[0].balance_nairat;

    if (balance < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // ➖ DEDUCT
    const deduct = await client.query(
      `UPDATE wallets
       SET balance_nairat = balance_nairat - $1
       WHERE user_id = $2 AND balance_nairat >= $1`,
      [amount, senderId]
    );

    if (deduct.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // ➕ CREDIT
    await client.query(
      "UPDATE wallets SET balance_nairat = balance_nairat + $1 WHERE user_id = $2",
      [amount, realReceiverId]
    );

    const reference = generateReference();

    // 🧾 SAVE TRANSACTION
    await client.query(
      `INSERT INTO transactions
      (sender_id, receiver_id, amount, type, category, idempotency_key, reference)
      VALUES ($1, $2, $3, 'transfer', $4, $5, $6)`,
      [senderId, realReceiverId, amount, category || "general", idempotency_key, reference]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Transfer successful",
      reference,
      amount,
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("TRANSFER ERROR FULL:", error);
    return res.status(500).json({ error: "Transfer failed" });
  } finally {
    client.release();
  }
};


const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `SELECT
        t.id,
        t.reference,
        t.sender_id,
        t.receiver_id,
        t.amount,
        t.category,
        t.type,
        t.created_at,
        CASE
          WHEN t.sender_id = $1 THEN 'sent'
          WHEN t.receiver_id = $1 THEN 'received'
        END AS direction,
        COALESCE(s.name, 'System') AS sender_name,
        COALESCE(r.name, 'System') AS receiver_name
      FROM transactions t
      LEFT JOIN users s ON t.sender_id = s.id
      LEFT JOIN users r ON t.receiver_id = r.id
      WHERE t.sender_id = $1 OR t.receiver_id = $1
      ORDER BY t.created_at DESC`,
      [userId]
    );

    return res.status(200).json({
      transactions: result.rows,
    });

  } catch (error) {
    console.error("Transaction history error:", error);
    return res.status(500).json({
      error: "Failed to fetch transactions",
    });
  }
};



const setBudget = async (req, res) => {
  const userId = req.userId;
  const { period, amount } = req.body;

  if (!period || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  if (!["daily", "weekly", "monthly"].includes(period)) {
    return res.status(400).json({ error: "Invalid period" });
  }

  try {
    await pool.query(
      `INSERT INTO budgets (user_id, period, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, period)
       DO UPDATE SET amount = EXCLUDED.amount`,
      [userId, period, amount]
    );

    return res.status(200).json({ message: "Budget saved" });

  } catch (err) {
    return res.status(500).json({ error: "Failed to save budget" });
  }
};



const deleteBudget = async (req, res) => {
  const userId = req.userId;
  const { period } = req.params;

  try {
    await pool.query(
      "DELETE FROM budgets WHERE user_id = $1 AND period = $2",
      [userId, period]
    );

    return res.status(200).json({ message: "Budget removed" });

  } catch (err) {
    return res.status(500).json({ error: "Failed to delete budget" });
  }
};



const getBudgets = async (req, res) => {
  const userId = req.userId;

  try {
    const result = await pool.query(
      "SELECT period, amount FROM budgets WHERE user_id = $1",
      [userId]
    );

    return res.status(200).json({
      data: result.rows,
    });

  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch budgets" });
  }
};


module.exports = {
  checkBudget,
  transfer,
  getTransactionHistory,
  setBudget,
  deleteBudget,
  getBudgets,
};