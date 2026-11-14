// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
// Step-by-step demo of the main use case for the 3-minute video.
// Run: npx hardhat run scripts/demo.js   (uses the in-process Hardhat network, test accounts only)
const { ethers } = require("hardhat");

const eth = (v) => ethers.formatEther(v) + " ETH (test)";
const line = (t) => console.log("\n=== " + t + " ===");

async function printBalances(label, escrow, seller, buyer) {
  const [s, b, e] = await Promise.all([
    ethers.provider.getBalance(seller.address),
    ethers.provider.getBalance(buyer.address),
    ethers.provider.getBalance(await escrow.getAddress()),
  ]);
  console.log(`[${label}] seller: ${eth(s)} | buyer: ${eth(b)} | escrow contract: ${eth(e)}`);
}

async function main() {
  const [admin, seller, buyer, sto, registrar] = await ethers.getSigners();
  const price = ethers.parseEther("7"); // stand-in for 7,000,000 KZT
  const vinHash = ethers.id("TEST-VIN-0001"); // invented VIN
  const reportHash = ethers.id("diagnostic-report-0001.pdf"); // invented report
  const names = ["None", "Created", "Funded", "Inspected", "Completed", "Refunded", "Cancelled"];

  line("1. Deploy VehicleEscrow on the local Hardhat network");
  const escrow = await ethers.deployContract("VehicleEscrow", [admin.address]);
  await escrow.waitForDeployment();
  console.log("contract address:", await escrow.getAddress());

  line("2. Admin grants roles to consortium nodes (STO and registrar)");
  await (await escrow.connect(admin).grantRole(await escrow.STO_ROLE(), sto.address)).wait();
  await (await escrow.connect(admin).grantRole(await escrow.REGISTRAR_ROLE(), registrar.address)).wait();
  console.log("STO node :", sto.address);
  console.log("registrar:", registrar.address);

  line("3. Seller creates a deal (VIN hash + price)");
  await (await escrow.connect(seller).createDeal(vinHash, price, 7 * 24 * 3600)).wait();
  console.log("deal 1 status:", names[Number((await escrow.getDeal(1)).status)]);
  await printBalances("before", escrow, seller, buyer);

  line("4. Buyer locks 100% of the price in escrow");
  await (await escrow.connect(buyer).lockPayment(1, { value: price })).wait();
  console.log("deal 1 status:", names[Number((await escrow.getDeal(1)).status)]);
  await printBalances("locked", escrow, seller, buyer);

  line("5. Certified STO writes the diagnostic report hash (inspection passed)");
  await (await escrow.connect(sto).confirmInspection(1, reportHash, true)).wait();
  console.log("deal 1 status:", names[Number((await escrow.getDeal(1)).status)]);

  line("6. Registrar confirms re-registration -> contract pays the seller");
  await (await escrow.connect(registrar).confirmReRegistration(1)).wait();
  console.log("deal 1 status:", names[Number((await escrow.getDeal(1)).status)]);
  await printBalances("paid", escrow, seller, buyer);

  line("7. Alternative path: failed inspection -> instant refund");
  await (await escrow.connect(seller).createDeal(ethers.id("TEST-VIN-0002"), price, 7 * 24 * 3600)).wait();
  await (await escrow.connect(buyer).lockPayment(2, { value: price })).wait();
  await printBalances("locked deal 2", escrow, seller, buyer);
  await (await escrow.connect(sto).confirmInspection(2, ethers.id("report-2.pdf"), false)).wait();
  console.log("deal 2 status:", names[Number((await escrow.getDeal(2)).status)]);
  await printBalances("refunded", escrow, seller, buyer);

  console.log("\nDone. Now run `npm test` to show the unit tests.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
