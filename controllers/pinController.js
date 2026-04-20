const pool = require("../database");
const bcrypt = require("bcryptjs");


const checkPinExists = async (req, res) => {
  try {

    const userId = req.userId;

    const result = await pool.query(
      "SELECT transaction_pin_hash FROM users WHERE id=$1",
      [userId]
    );

    const hasPin = result.rows[0].transaction_pin_hash !== null;

    res.json({
      has_pin: hasPin
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });

  }
};



const createPin = async (req, res) => {

  try {

    const userId = req.userId;
    const { pin } = req.body;

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        error: "PIN must be exactly 4 digits"
      });
    }

    const hash = await bcrypt.hash(pin, 10);

    await pool.query(
      "UPDATE users SET transaction_pin_hash=$1 WHERE id=$2",
      [hash, userId]
    );

    res.json({
      message: "Transaction PIN created"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });

  }

};



const verifyPin = async (req, res) => {

  try {

    const userId = req.userId;
    const { pin } = req.body;

    const result = await pool.query(
      "SELECT transaction_pin_hash FROM users WHERE id=$1",
      [userId]
    );

    const hash = result.rows[0].transaction_pin_hash;

    if (!hash) {

      return res.status(400).json({
        error: "Transaction PIN not set"
      });

    }

    const match = await bcrypt.compare(pin, hash);

    if (!match) {

      return res.status(401).json({
        verified: false,
        error: "Incorrect PIN"
      });

    }

    res.json({
      verified: true
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });

  }

};



module.exports = {
  checkPinExists,
  createPin,
  verifyPin
};