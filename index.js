require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const PORT = process.env.PORT || 3000;


const app = express();

const authRoutes = require("./routes/authRoutes");
const walletRoutes = require("./routes/walletRoutes");
const transactionRoutes = require("./routes/transactionRoutes");
const userRoutes = require("./routes/userRoutes");
const pinRoutes = require("./routes/pinRoutes");
const authenticate = require("./middleware/authMiddleware");
const analyticsRoutes = require('./routes/analyticsRoutes');
const budgetRoutes = require('./routes/budgetRoutes');
const otpRoutes = require("./routes/otpRoutes");

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Nairat Wallet API",
      version: "1.0.0",
      description: "API documentation for the Nairat digital wallet system",
    },
    servers: [
      {
        url: "http://localhost:3000",
      },
    ],
  },
  apis: ["./routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use(cors({
  origin: true,
  credentials: true,
}));


app.use(express.json());
app.use(cookieParser());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/auth", authRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pin", pinRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/budget", budgetRoutes);

app.get("/api/protected", authenticate, (req, res) => {
  res.json({
    message: "Access granted",
    userId: req.userId,
  });
});

app.get("/", (req, res) => {
  res.redirect("/api-docs");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});