const pool = require("../database");



const lookupUser = async (req, res) => {

  const { identifier } = req.query;

  try {

    const result = await pool.query(
      `SELECT id, name, email, account_number
       FROM users
       WHERE email = $1 OR account_number = $1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.json({
        found: false
      });
    }

    const user = result.rows[0];

    res.json({
      found: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        account_number: user.account_number
      }
    });

  } catch (error) {

    console.error("Lookup error:", error);

    res.status(500).json({
      error: "Lookup failed"
    });

  }

};
const updateName = async (req, res) => {
  try {
    const userId = req.userId;
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        error: "Invalid name"
      });
    }

    const result = await pool.query(
      `UPDATE users 
       SET name = $1 
       WHERE id = $2
       RETURNING name`,
      [name.trim(), userId]
    );

    res.json({
      message: "Name updated successfully",
      user: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Server error"
    });
  }
};

module.exports = {
  lookupUser,
  updateName
};