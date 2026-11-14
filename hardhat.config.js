// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
require("@nomicfoundation/hardhat-toolbox");

/** Local development only: Hardhat Network with test accounts. No public or main networks are configured. */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
};
