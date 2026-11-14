// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VehicleEscrow
 * @notice Educational prototype for the course "Introduction to Finance".
 *         Not a real product, service or investment offer. Do not use with real funds.
 *
 * Core use case (used car sale with escrow):
 *   1. Seller registers a deal (hash of the VIN + price).
 *   2. Buyer locks 100% of the price in the contract.
 *   3. A certified STO (inspection station) writes the hash of the diagnostic report:
 *        - passed  -> deal becomes "Inspected"
 *        - failed  -> buyer is refunded instantly
 *   4. A registrar node confirms re-registration of the car -> contract pays the seller.
 *   5. If the deadline passes without completion, anyone can trigger a refund to the buyer.
 *
 * Roles:
 *   - DEFAULT_ADMIN_ROLE : grants/revokes roles and can pause. CANNOT move funds.
 *   - STO_ROLE           : certified inspection stations (consortium nodes).
 *   - REGISTRAR_ROLE     : node that confirms vehicle re-registration.
 *   - Seller / Buyer     : any address, per deal (not a role).
 *
 * Privacy: no personal data is stored on-chain, only addresses, price and hashes.
 * Payment uses the chain's native test currency as a stand-in for a settlement asset.
 */
contract VehicleEscrow is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant STO_ROLE = keccak256("STO_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    enum Status {
        None,
        Created,
        Funded,
        Inspected,
        Completed,
        Refunded,
        Cancelled
    }

    struct Deal {
        address seller;
        address buyer;
        uint256 price;
        uint64 duration; // seconds the buyer's funds stay locked before a refund is possible
        uint64 deadline; // set when the payment is locked
        bytes32 vinHash; // keccak256 of the VIN (no raw data on-chain)
        bytes32 reportHash; // hash of the STO diagnostic report (PDF stays off-chain)
        Status status;
    }

    uint256 public dealCount;
    mapping(uint256 => Deal) private _deals;

    event DealCreated(uint256 indexed dealId, address indexed seller, bytes32 vinHash, uint256 price);
    event PaymentLocked(uint256 indexed dealId, address indexed buyer, uint256 amount, uint64 deadline);
    event InspectionConfirmed(uint256 indexed dealId, address indexed sto, bytes32 reportHash, bool passed);
    event DealCompleted(uint256 indexed dealId, address indexed seller, uint256 amount);
    event DealRefunded(uint256 indexed dealId, address indexed buyer, uint256 amount);
    event DealCancelled(uint256 indexed dealId);

    error DealNotFound();
    error InvalidStatus(Status current);
    error InvalidParameters();
    error NotSeller();
    error SellerCannotBuy();
    error WrongAmount();
    error DealExpired();
    error DeadlineNotPassed();
    error TransferFailed();

    constructor(address admin) {
        if (admin == address(0)) revert InvalidParameters();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- deal flow

    /// @notice Seller registers a deal. Returns the new deal id.
    function createDeal(bytes32 vinHash, uint256 price, uint64 duration)
        external
        whenNotPaused
        returns (uint256 dealId)
    {
        if (vinHash == bytes32(0) || price == 0 || duration == 0) revert InvalidParameters();

        dealId = ++dealCount;
        _deals[dealId] = Deal({
            seller: msg.sender,
            buyer: address(0),
            price: price,
            duration: duration,
            deadline: 0,
            vinHash: vinHash,
            reportHash: bytes32(0),
            status: Status.Created
        });

        emit DealCreated(dealId, msg.sender, vinHash, price);
    }

    /// @notice Buyer locks exactly 100% of the price in the contract.
    function lockPayment(uint256 dealId) external payable whenNotPaused nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.status != Status.Created) revert InvalidStatus(d.status);
        if (msg.sender == d.seller) revert SellerCannotBuy();
        if (msg.value != d.price) revert WrongAmount();

        d.buyer = msg.sender;
        d.deadline = uint64(block.timestamp) + d.duration;
        d.status = Status.Funded;

        emit PaymentLocked(dealId, msg.sender, msg.value, d.deadline);
    }

    /// @notice Certified STO writes the diagnostic report hash. A failed inspection refunds the buyer at once.
    function confirmInspection(uint256 dealId, bytes32 reportHash, bool passed)
        external
        onlyRole(STO_ROLE)
        whenNotPaused
        nonReentrant
    {
        Deal storage d = _getDeal(dealId);
        if (d.status != Status.Funded) revert InvalidStatus(d.status);
        if (block.timestamp > d.deadline) revert DealExpired();
        if (reportHash == bytes32(0)) revert InvalidParameters();

        d.reportHash = reportHash;
        emit InspectionConfirmed(dealId, msg.sender, reportHash, passed);

        if (passed) {
            d.status = Status.Inspected;
        } else {
            _refund(dealId, d);
        }
    }

    /// @notice Registrar node confirms re-registration; the contract pays the seller automatically.
    function confirmReRegistration(uint256 dealId) external onlyRole(REGISTRAR_ROLE) whenNotPaused nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.status != Status.Inspected) revert InvalidStatus(d.status);
        if (block.timestamp > d.deadline) revert DealExpired();

        // effects before interaction
        d.status = Status.Completed;
        uint256 amount = d.price;
        address seller = d.seller;

        (bool ok,) = seller.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit DealCompleted(dealId, seller, amount);
    }

    /// @notice After the deadline anyone can trigger a refund; the money always goes to the buyer.
    function refund(uint256 dealId) external nonReentrant {
        Deal storage d = _getDeal(dealId);
        if (d.status != Status.Funded && d.status != Status.Inspected) revert InvalidStatus(d.status);
        if (block.timestamp <= d.deadline) revert DeadlineNotPassed();

        _refund(dealId, d);
    }

    /// @notice Seller can cancel a deal that has not been funded yet.
    function cancelDeal(uint256 dealId) external {
        Deal storage d = _getDeal(dealId);
        if (msg.sender != d.seller) revert NotSeller();
        if (d.status != Status.Created) revert InvalidStatus(d.status);

        d.status = Status.Cancelled;
        emit DealCancelled(dealId);
    }

    // -------------------------------------------------------------------- admin

    /// @notice Emergency stop for new activity. The admin has no way to touch escrowed funds.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // --------------------------------------------------------------------- views

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        return _getDeal(dealId);
    }

    // ----------------------------------------------------------------- internals

    function _getDeal(uint256 dealId) private view returns (Deal storage d) {
        d = _deals[dealId];
        if (d.status == Status.None) revert DealNotFound();
    }

    /// @dev Checks-effects-interactions: state is updated before the external call.
    function _refund(uint256 dealId, Deal storage d) private {
        d.status = Status.Refunded;
        uint256 amount = d.price;
        address buyer = d.buyer;

        (bool ok,) = buyer.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit DealRefunded(dealId, buyer, amount);
    }
}
