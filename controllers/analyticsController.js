const pool = require("../database");

/// INSIGHTS ENGINE
const generateInsights = (categories, weekly, previous_week, monthly, previous_month, txCount) => {
  const insights = [];

  const total = categories.reduce(
    (sum, c) => sum + Number(c.total),
    0
  );

  // Top category insight
  if (categories.length > 0 && total > 0) {
    const top = categories[0];
    const percentage = ((top.total / total) * 100).toFixed(0);

    insights.push(
      `You spent ${percentage}% of your money on ${top.category}`
    );
  }

  // Weekly comparison
  if (previous_week > 0) {
    const diff = ((weekly - previous_week) / previous_week) * 100;

    if (diff > 10) {
      insights.push(
        `Your spending is up ${diff.toFixed(0)}% compared to last week`
      );
    } else if (diff < -10) {
      insights.push(
        `You spent ${Math.abs(diff).toFixed(0)}% less than last week`
      );
    }
  }

  // Monthly comparison
  if (previous_month > 0) {
    const diff = ((monthly - previous_month) / previous_month) * 100;

    if (diff > 10) {
      insights.push(
        `Your monthly spending increased by ${diff.toFixed(0)}%`
      );
    } else if (diff < -10) {
      insights.push(
        `You reduced your monthly spending by ${Math.abs(diff).toFixed(0)}%`
      );
    }
  }

  // Activity insight
  if (txCount > 0) {
    insights.push(
      `You made ${txCount} transactions in the last 30 days`
    );
  }

  return insights;
};


///  MAIN ANALYTICS CONTROLLER
const getAnalytics = async (req, res) => {
  const userId = req.userId;

  try {
    const result = await pool.query(
      `
      WITH tx AS (
        SELECT *
        FROM transactions
        WHERE sender_id = $1
        AND type = 'transfer'
        AND created_at >= NOW() - INTERVAL '60 days'
      ),

      daily AS (
        SELECT 
          DATE(created_at) as date,
          SUM(amount) as total
        FROM tx
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      ),

      weekly AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM tx
        WHERE created_at >= NOW() - INTERVAL '7 days'
      ),

      previous_week AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM tx
        WHERE created_at >= NOW() - INTERVAL '14 days'
        AND created_at < NOW() - INTERVAL '7 days'
      ),

      monthly AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM tx
        WHERE created_at >= NOW() - INTERVAL '30 days'
      ),

      previous_month AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM tx
        WHERE created_at >= NOW() - INTERVAL '60 days'
        AND created_at < NOW() - INTERVAL '30 days'
      ),

      categories AS (
        SELECT 
          COALESCE(category, 'general') as category,
          SUM(amount) as total
        FROM tx
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY category
        ORDER BY total DESC
        LIMIT 6
      ),

      income AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM transactions
        WHERE receiver_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
      )

      SELECT
        (SELECT json_agg(daily) FROM daily) as daily,
        (SELECT total FROM weekly) as weekly,
        (SELECT total FROM previous_week) as previous_week,
        (SELECT total FROM monthly) as monthly,
        (SELECT total FROM previous_month) as previous_month,
        (SELECT json_agg(categories) FROM categories) as categories,
        (SELECT total FROM income) as total_income
      `,
      [userId]
    );

    const data = result.rows[0];

    const daily = data.daily || [];
    const weekly = Number(data.weekly || 0);
    const previous_week = Number(data.previous_week || 0);
    const monthly = Number(data.monthly || 0);
    const previous_month = Number(data.previous_month || 0);
    const categories = data.categories || [];
    const total_income = Number(data.total_income || 0);

    ///  GENERATE INSIGHTS
    const insights = generateInsights(
      categories,
      weekly,
      previous_week,
      monthly,
      previous_month,
      daily.length
    );

    ///  FINAL RESPONSE
    res.json({
      data: {
        daily,
        weekly,
        previous_week,
        monthly,
        previous_month,
        categories,
        total_income,
        insights,
      },
    });

  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ message: "Analytics error" });
  }
};

module.exports = {
  getAnalytics,
};