function generateReference() {

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let ref = "TXN_";

  for (let i = 0; i < 7; i++) {
    ref += chars[Math.floor(Math.random() * chars.length)];
  }

  return ref;
}

module.exports = generateReference;