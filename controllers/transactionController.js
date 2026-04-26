const pool = require("../database");
const bcrypt = require("bcryptjs");
const generateReference = require("../services/referenceGenerator");

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

const ALLOWED_REASONS = [
  "medical_emergency",
  "family_emergency",
  "urgent_bill",
  "essential_purchase",
];

/**
 * Returns the start timestamp of the current period.
 * - daily: today at 00:00
 * - weekly: this week's Monday at 00:00
 * - monthly: 1st of this month at 00:00
 */
const periodStartFor = (period) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "weekly") {
    // ISO weeks (Monday start). getDay() returns 0=Sun..6=Sat
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
    start.setDate(start.getDate() + diff);
  } else if (period === "monthly") {
    start.setDate(1);
  }

  return start;
};

/**
 * Check if a transaction would exceed any budget.
 * Returns { exceeded: false } or { exceeded: true, period, spent, limit, attempted }
 */
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
    const limit = Number(b.amount);

    if (spent + amount > limit) {
      return {
        exceeded: true,
        period: b.period,
        spent,
        limit,
        attempted: amount,
        excess: spent + amount - limit,
      };
    }
  }

  return { exceeded: false };
};

/**
 * Check if the user has already used their grace override
 * for the current period. Returns true if they CAN override.
 */
const hasOverrideAvailable = async (client, userId, period) => {
  const start = periodStartFor(period);

  const result = await client.query(
    `SELECT id FROM budget_overrides
     WHERE user_id = $1
     AND period = $2
     AND period_start = $3`,
    [userId, period, start]
  );

  return result.rows.length === 0;
};

// ─────────────────────────────────────────────────────────────────────────
// TRANSFER
// ─────────────────────────────────────────────────────────────────────────

const transfer = async (req, res) => {
  const senderId = req.userId;
  const {
    receiver_id,
    amount,
    idempotency_key,
    pin,
    category,
    override_reason,
  } = req.body;

  if (!receiver_id || !amount || !pin || !idempotency_key) {
    return res.status(400).json({
      error: "receiver_id, amount, pin and idempotency_key required",
    });
  }

  if (amount <= 0) {
    return res.status(400).json({ error: "Amount must be greater than 0" });
  }

  const allowedCategories = [
    "food",
    "transport",
    "shopping",
    "bills",
    "entertainment",
    "general",
  ];

  if (category && !allowedCategories.includes(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }

  // If the client sent an override_reason, validate it's allowed
  if (override_reason && !ALLOWED_REASONS.includes(override_reason)) {
    return res.status(400).json({ error: "Invalid override reason" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Find receiver
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

    // Verify PIN
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

    // Budget check
    const budgetCheck = await checkBudget(client, senderId, amount);

    if (budgetCheck.exceeded) {
      // No override attempted — return 400 with details
      if (!override_reason) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "BUDGET_EXCEEDED",
          period: budgetCheck.period,
          spent: budgetCheck.spent,
          limit: budgetCheck.limit,
          attempted: budgetCheck.attempted,
          excess: budgetCheck.excess,
        });
      }

      // Override attempted — check if the user has grace available
      const canOverride = await hasOverrideAvailable(
        client,
        senderId,
        budgetCheck.period
      );

      if (!canOverride) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: "OVERRIDE_ALREADY_USED",
          period: budgetCheck.period,
          message: `You've already used your one-time grace for your ${budgetCheck.period} budget. You'll get another grace when the period resets.`,
        });
      }

      // Override is valid and available — let the transaction proceed,
      // but we'll log it to budget_overrides after we get the transaction ID.
    }

    // Idempotency check
    const existing = await client.query(
      "SELECT id FROM transactions WHERE idempotency_key = $1",
      [idempotency_key]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(409)
        .json({ error: "Duplicate transaction prevented" });
    }

    // Lock wallets
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
      return res.status(404).json({ error: "Receiver wallet not found" });
    }

    const balance = senderWallet.rows[0].balance_nairat;

    if (balance < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Deduct
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

    // Credit
    await client.query(
      "UPDATE wallets SET balance_nairat = balance_nairat + $1 WHERE user_id = $2",
      [amount, realReceiverId]
    );

    const reference = generateReference();

    // Save transaction (capture inserted ID for override linking)
    const txInsert = await client.query(
      `INSERT INTO transactions
      (sender_id, receiver_id, amount, type, category, idempotency_key, reference)
      VALUES ($1, $2, $3, 'transfer', $4, $5, $6)
      RETURNING id`,
      [
        senderId,
        realReceiverId,
        amount,
        category || "general",
        idempotency_key,
        reference,
      ]
    );

    const transactionId = txInsert.rows[0].id;

    // If this transfer used an override, log it
    if (budgetCheck.exceeded && override_reason) {
      await client.query(
        `INSERT INTO budget_overrides
         (user_id, period, reason, amount, transaction_id, period_start)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          senderId,
          budgetCheck.period,
          override_reason,
          amount,
          transactionId,
          periodStartFor(budgetCheck.period),
        ]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Transfer successful",
      reference,
      amount,
      override_used: !!(budgetCheck.exceeded && override_reason),
      override_period: budgetCheck.exceeded ? budgetCheck.period : null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("TRANSFER ERROR:", error);
    return res.status(500).json({ error: "Transfer failed" });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────
// TRANSACTION HISTORY
// ─────────────────────────────────────────────────────────────────────────

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

    return res.status(200).json({ transactions: result.rows });
  } catch (error) {
    console.error("Transaction history error:", error);
    return res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// BUDGETS
// ─────────────────────────────────────────────────────────────────────────

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

const getBudgets = async (req, res) => {
  const userId = req.userId;

  try {
    const result = await pool.query(
      "SELECT period, amount FROM budgets WHERE user_id = $1",
      [userId]
    );

    return res.status(200).json({ data: result.rows });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch budgets" });
  }
};

/**
 * Returns the user's current grace status:
 * which periods have an override available, which already used.
 */
const getOverrideStatus = async (req, res) => {
  const userId = req.userId;

  try {
    const periods = ["daily", "weekly", "monthly"];
    const result = {};

    for (const p of periods) {
      const start = periodStartFor(p);
      const used = await pool.query(
        `SELECT id, reason, used_at FROM budget_overrides
         WHERE user_id = $1 AND period = $2 AND period_start = $3`,
        [userId, p, start]
      );

      result[p] = {
        available: used.rows.length === 0,
        used_at: used.rows[0]?.used_at || null,
        reason: used.rows[0]?.reason || null,
      };
    }

    return res.status(200).json({ data: result });
  } catch (err) {
    console.error("Override status error:", err);
    return res.status(500).json({ error: "Failed to fetch override status" });
  }
};

module.exports = {
  checkBudget,
  transfer,
  getTransactionHistory,
  setBudget,
  getBudgets,
  getOverrideStatus,
};