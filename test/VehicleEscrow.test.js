// Educational project for the course Introduction to Finance.
// Not a real product, service or investment offer. Do not use with real funds.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const STATUS = { None: 0n, Created: 1n, Funded: 2n, Inspected: 3n, Completed: 4n, Refunded: 5n, Cancelled: 6n };
const PRICE = ethers.parseEther("7"); // stand-in for a 7,000,000 KZT car (test currency only)
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const VIN_HASH = ethers.id("TEST-VIN-0001"); // invented VIN, hashed
const REPORT_HASH = ethers.id("diagnostic-report-0001.pdf"); // invented report, hashed

async function deployFixture() {
  const [admin, seller, buyer, sto, registrar, other] = await ethers.getSigners();

  const escrow = await ethers.deployContract("VehicleEscrow", [admin.address]);
  await escrow.waitForDeployment();

  const STO_ROLE = await escrow.STO_ROLE();
  const REGISTRAR_ROLE = await escrow.REGISTRAR_ROLE();
  await escrow.connect(admin).grantRole(STO_ROLE, sto.address);
  await escrow.connect(admin).grantRole(REGISTRAR_ROLE, registrar.address);

  return { escrow, admin, seller, buyer, sto, registrar, other, STO_ROLE, REGISTRAR_ROLE };
}

// deal 1: created by seller, payment locked by buyer
async function fundedDealFixture() {
  const ctx = await deployFixture();
  const { escrow, seller, buyer } = ctx;
  await escrow.connect(seller).createDeal(VIN_HASH, PRICE, SEVEN_DAYS);
  await escrow.connect(buyer).lockPayment(1, { value: PRICE });
  return { ...ctx, dealId: 1n };
}

describe("VehicleEscrow", function () {
  it("1. happy path: create -> lock -> inspect -> re-register pays the seller", async function () {
    const { escrow, seller, buyer, sto, registrar } = await loadFixture(deployFixture);

    await expect(escrow.connect(seller).createDeal(VIN_HASH, PRICE, SEVEN_DAYS))
      .to.emit(escrow, "DealCreated")
      .withArgs(1n, seller.address, VIN_HASH, PRICE);

    await expect(escrow.connect(buyer).lockPayment(1, { value: PRICE })).to.changeEtherBalances(
      [buyer, escrow],
      [-PRICE, PRICE]
    );
    expect((await escrow.getDeal(1)).status).to.equal(STATUS.Funded);

    await escrow.connect(sto).confirmInspection(1, REPORT_HASH, true);
    const inspected = await escrow.getDeal(1);
    expect(inspected.status).to.equal(STATUS.Inspected);
    expect(inspected.reportHash).to.equal(REPORT_HASH);

    await expect(escrow.connect(registrar).confirmReRegistration(1)).to.changeEtherBalances(
      [seller, escrow],
      [PRICE, -PRICE]
    );
    expect((await escrow.getDeal(1)).status).to.equal(STATUS.Completed);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
  });

  it("2. rejects a payment that is not exactly the price, and the seller buying own car", async function () {
    const { escrow, seller, buyer } = await loadFixture(deployFixture);
    await escrow.connect(seller).createDeal(VIN_HASH, PRICE, SEVEN_DAYS);

    await expect(escrow.connect(buyer).lockPayment(1, { value: PRICE - 1n })).to.be.revertedWithCustomError(
      escrow,
      "WrongAmount"
    );
    await expect(escrow.connect(seller).lockPayment(1, { value: PRICE })).to.be.revertedWithCustomError(
      escrow,
      "SellerCannotBuy"
    );
  });

  it("3. access control: only an STO can confirm inspection, only a registrar can release funds", async function () {
    const { escrow, buyer, other, STO_ROLE, REGISTRAR_ROLE } = await loadFixture(fundedDealFixture);

    await expect(escrow.connect(buyer).confirmInspection(1, REPORT_HASH, true))
      .to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount")
      .withArgs(buyer.address, STO_ROLE);

    await expect(escrow.connect(other).confirmReRegistration(1))
      .to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount")
      .withArgs(other.address, REGISTRAR_ROLE);
  });

  it("4. failed inspection refunds the buyer instantly", async function () {
    const { escrow, buyer, sto } = await loadFixture(fundedDealFixture);

    await expect(escrow.connect(sto).confirmInspection(1, REPORT_HASH, false)).to.changeEtherBalances(
      [buyer, escrow],
      [PRICE, -PRICE]
    );
    expect((await escrow.getDeal(1)).status).to.equal(STATUS.Refunded);
  });

  it("5. funds cannot be released before a passed inspection", async function () {
    const { escrow, registrar } = await loadFixture(fundedDealFixture);

    await expect(escrow.connect(registrar).confirmReRegistration(1)).to.be.revertedWithCustomError(
      escrow,
      "InvalidStatus"
    );
  });

  it("6. refund after the deadline: blocked before, allowed after, goes to the buyer", async function () {
    const { escrow, buyer, other } = await loadFixture(fundedDealFixture);

    await expect(escrow.connect(other).refund(1)).to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");

    await time.increase(SEVEN_DAYS + 1);

    // a third party triggers it, but the money still goes to the buyer
    await expect(escrow.connect(other).refund(1)).to.changeEtherBalances([buyer, escrow], [PRICE, -PRICE]);
    expect((await escrow.getDeal(1)).status).to.equal(STATUS.Refunded);

    // cannot refund twice
    await expect(escrow.connect(other).refund(1)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("7. an expired deal cannot be inspected or completed", async function () {
    const { escrow, sto } = await loadFixture(fundedDealFixture);
    await time.increase(SEVEN_DAYS + 1);

    await expect(escrow.connect(sto).confirmInspection(1, REPORT_HASH, true)).to.be.revertedWithCustomError(
      escrow,
      "DealExpired"
    );
  });

  it("8. admin can pause but has no access to funds or to the deal flow", async function () {
    const { escrow, admin, seller, STO_ROLE } = await loadFixture(fundedDealFixture);

    // admin has the admin role only, not the STO or registrar roles
    expect(await escrow.hasRole(STO_ROLE, admin.address)).to.equal(false);
    await expect(escrow.connect(admin).confirmInspection(1, REPORT_HASH, true)).to.be.revertedWithCustomError(
      escrow,
      "AccessControlUnauthorizedAccount"
    );

    // pause stops new deals, escrowed funds stay untouched
    await escrow.connect(admin).pause();
    await expect(escrow.connect(seller).createDeal(VIN_HASH, PRICE, SEVEN_DAYS)).to.be.revertedWithCustomError(
      escrow,
      "EnforcedPause"
    );
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(PRICE);

    // a refund after the deadline still works while paused, so money is never trapped
    await time.increase(SEVEN_DAYS + 1);
    await expect(escrow.connect(seller).refund(1)).to.not.be.reverted;
  });

  it("9. only the seller can cancel, and only before the payment is locked", async function () {
    const { escrow, seller, buyer, other } = await loadFixture(deployFixture);
    await escrow.connect(seller).createDeal(VIN_HASH, PRICE, SEVEN_DAYS);

    await expect(escrow.connect(other).cancelDeal(1)).to.be.revertedWithCustomError(escrow, "NotSeller");

    await escrow.connect(seller).cancelDeal(1);
    expect((await escrow.getDeal(1)).status).to.equal(STATUS.Cancelled);

    // a cancelled deal cannot be funded
    await expect(escrow.connect(buyer).lockPayment(1, { value: PRICE })).to.be.revertedWithCustomError(
      escrow,
      "InvalidStatus"
    );
  });

  it("10. reentrancy attack on refund is blocked (buyer is paid exactly once)", async function () {
    const { escrow, seller, other } = await loadFixture(deployFixture);

    const attacker = await ethers.deployContract("MaliciousBuyer", [await escrow.getAddress()]);
    await attacker.waitForDeployment();

    // a second honest deal sits in the contract, so a successful attack would have funds to steal
    await escrow.connect(seller).createDeal(VIN_HASH, PRICE, SEVEN_DAYS); // deal 1
    await escrow.connect(seller).createDeal(ethers.id("TEST-VIN-0002"), PRICE, SEVEN_DAYS); // deal 2
    await escrow.connect(other).lockPayment(2, { value: PRICE }); // honest buyer funds deal 2
    await attacker.lock(1, { value: PRICE }); // attacker funds deal 1

    await time.increase(SEVEN_DAYS + 1);
    await escrow.connect(other).refund(1); // pays the attacker contract, which tries to re-enter

    expect(await attacker.attempts()).to.equal(1n); // the attack was attempted
    expect(await attacker.reentrySucceeded()).to.equal(false); // and failed
    expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(PRICE); // paid once
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(PRICE); // deal 2 untouched
  });
});
