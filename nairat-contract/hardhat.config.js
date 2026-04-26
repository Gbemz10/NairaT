require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      url: "https://eth-sepolia.g.alchemy.com/v2/EvxNv4nHc-wBeC852ZdrY",
      accounts: ["6e8925bd05dca41936d48847ef4abe151457bf418e39f2bccea19e3f0e4c66d6"],
    },
  },
};