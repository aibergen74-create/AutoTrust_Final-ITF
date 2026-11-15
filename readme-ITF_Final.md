Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# AutoTrustEscrow KZ: VehicleEscrow prototype

Final Project prototype (Introduction to Finance, Astana IT University, 2026-2027).
Startup idea: blockchain vehicle history registry and secure escrow for the used car market in Kazakhstan (invented startup, invented data).

* **Demo video (3 min):** https://www.google.com/search?q=https://drive.google.com/drive/folders/1brrKU96afk6m9z32Yc3nNPo7Y4OSya3a%3Fusp%3Dsharing

* **GitHub repository:** https://www.google.com/search?q=https://drive.google.com/drive/folders/1brrKU96afk6m9z32Yc3nNPo7Y4OSya3a%3Fusp%3Dsharing

* **Testnet contract address:** none (local Hardhat network only)

## What the prototype does

`VehicleEscrow` is one Solidity smart contract for the core use case: a used car sale where the buyer's money is held in escrow until the car passes a certified inspection (STO) and is re-registered.

1. Seller calls `createDeal(vinHash, price, duration)`.

2. Buyer calls `lockPayment(dealId)` and sends exactly 100% of the price.

3. A certified STO node calls `confirmInspection(dealId, reportHash, passed)`. If the car fails, the buyer is refunded instantly.

4. A registrar node calls `confirmReRegistration(dealId)`, and the contract pays the seller.

5. If the deadline passes without completion, anyone can call `refund(dealId)`; the money always goes to the buyer.

Only hashes (VIN hash, report hash), addresses and the price are stored on-chain. No personal data. All VINs, reports and amounts in tests and demo are invented, and the payment currency is the local chain's test currency.

### Roles and access rights

| Role | Who | Allowed | 
| ----- | ----- | ----- | 
| `DEFAULT_ADMIN_ROLE` | platform admin (multisig in production) | grant/revoke roles, `pause`/`unpause`. **Cannot move funds.** | 
| `STO_ROLE` | certified inspection stations | `confirmInspection` | 
| `REGISTRAR_ROLE` | re-registration node | `confirmReRegistration` | 
| Seller / Buyer | any address, per deal | `createDeal`, `cancelDeal` / `lockPayment` | 

### Main use case (sequence diagram)

```
sequenceDiagram
    autonumber
    actor Seller
    actor Buyer
    participant C as VehicleEscrow (smart contract)
    participant STO as Certified STO node
    participant Reg as Registrar node
    Seller->>C: createDeal(vinHash, price, duration)
    Buyer->>C: lockPayment(dealId) + 100% of price
    STO->>C: confirmInspection(dealId, reportHash, passed)
    alt inspection passed
        Reg->>C: confirmReRegistration(dealId)
        C->>Seller: transfer price (Completed)
    else inspection failed
        C->>Buyer: instant refund (Refunded)
    else deadline passed
        Buyer->>C: refund(dealId)
        C->>Buyer: refund (Refunded)
    end



```

## How to run (local network only)

Requirements: Node.js 20 LTS (18 or 22 should also work) and npm.

```
npm install
npx hardhat compile
npm test            # runs 10 unit tests on the local Hardhat network
npm run demo        # step-by-step demo of the main use case (for the video)



```

Optional, to deploy on a persistent local node:

```
npx hardhat node                 # terminal 1: local chain with test accounts
npm run deploy:local             # terminal 2



```

No `.env` file, private key or seed phrase is needed. Never deploy to a main network and never connect this code to real funds.

## Tests

| \# | Test | Checks | 
| ----- | ----- | ----- | 
| 1 | happy path | create, lock, inspect, re-register, seller paid, contract balance 0 | 
| 2 | wrong amount / seller buys own car | input validation | 
| 3 | access control | only STO inspects, only registrar releases | 
| 4 | failed inspection | instant refund to buyer | 
| 5 | no release without inspection | state machine | 
| 6 | refund after deadline | blocked before, allowed after, no double refund | 
| 7 | expired deal | cannot be inspected | 
| 8 | admin powers | admin can pause, cannot touch funds or the flow, refunds work while paused | 
| 9 | cancel | only seller, only before funding | 
| 10 | reentrancy attack | malicious buyer contract cannot re-enter `refund` | 

## Security notes

* **Reentrancy:** checks-effects-interactions plus OpenZeppelin `ReentrancyGuard` (test 10).

* **Broken access control:** OpenZeppelin `AccessControl`, separate roles, admin has no fund-moving function (tests 3, 8).

* **Key loss/theft:** admin key should be a multisignature wallet in production (not part of this prototype).

* Not audited. An external audit is planned in the budget of the project report.

## Project structure

```
contracts/VehicleEscrow.sol        main contract
contracts/mocks/MaliciousBuyer.sol test helper for the reentrancy test
test/VehicleEscrow.test.js         10 unit tests
scripts/demo.js, scripts/deploy.js demo for the video, local deploy
docs/sequence-diagram.(mmd|png)    Figure 1



```

## Credits and AI disclosure

* Open-source code: [OpenZeppelin Contracts](https://www.google.com/search?q=https%3A%2F%2Fgithub.com%2FOpenZeppelin%2Fopenzeppelin-contracts) 5.x (MIT licence): `AccessControl`, `ReentrancyGuard`, `Pausable`.

* Tools: Hardhat (MIT).

* AI Disclosure: Google Gemini (Gemini 2.5 Pro) was used for academic English proofreading and APA 7th citation formatting in the project report; Anthropic Claude (Claude 3.5 Sonnet) assisted with Hardhat test boilerplate and Mermaid diagram syntax. All contract logic (`VehicleEscrow.sol`, `MaliciousBuyer.sol`), role permissions, and financial models were reviewed, tested, and verified by the team.

## Team

* **Aibergen Amanzhol** — Group `[SE/CS-XXXX]` — Team Lead, Legal & Regulatory Compliance, Pitch (`@<github-username>`)

* **Zhanassyl Omar** — Group `[SE/CS-XXXX]` — Business Model, Market Sizing & Risk Matrix (`@<github-username>`)

* **Abay Tleugalyyev** — Group `[SE/CS-XXXX]` — CTO, Smart Contract Prototype & Hardhat Test Suite (`@<github-username>`)

* **Adilzhan Tolegen** — Group `[SE/CS-XXXX]` — CFO, 3-Year Financial Plan, DCF/NPV & Sensitivity Analysis (`@<github-username>`)