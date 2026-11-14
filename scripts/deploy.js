// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
// Deploys VehicleEscrow on a LOCAL node (run `npx hardhat node` in another terminal first).
const { ethers, network } = require("hardhat");

async function main() {
  if (network.name !== "localhost" && network.name !== "hardhat") {
    throw new Error("Local networks only. Refusing to deploy to " + network.name);
  }

  const [admin, , , sto, registrar] = await ethers.getSigners(); // test accounts created by Hardhat
  const escrow = await ethers.deployContract("VehicleEscrow", [admin.address]);
  await escrow.waitForDeployment();

  await (await escrow.connect(admin).grantRole(await escrow.STO_ROLE(), sto.address)).wait();
  await (await escrow.connect(admin).grantRole(await escrow.REGISTRAR_ROLE(), registrar.address)).wait();

  console.log("VehicleEscrow deployed to:", await escrow.getAddress());
  console.log("admin     :", admin.address);
  console.log("STO node  :", sto.address);
  console.log("registrar :", registrar.address);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
