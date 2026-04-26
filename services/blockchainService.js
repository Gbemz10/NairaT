const { ethers } = require("ethers");

const ABI = [
  "function mint(address to, uint256 amount) external",
  "function burn(address from, uint256 amount) external",
];

const getContract = () => {
  const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  return new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);
};

async function mintTokens(toAddress, amount) {
  try {
    const contract = getContract();
    const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
    const tx = await contract.mint(toAddress, amountWei);
    await tx.wait();
    return { success: true, txHash: tx.hash };
  } catch (err) {
    console.error("Mint error:", err.message);
    return { success: false, error: err.message };
  }
}

async function burnTokens(fromAddress, amount) {
  try {
    const contract = getContract();
    const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
    const tx = await contract.burn(fromAddress, amountWei);
    await tx.wait();
    return { success: true, txHash: tx.hash };
  } catch (err) {
    console.error("Burn error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { mintTokens, burnTokens };