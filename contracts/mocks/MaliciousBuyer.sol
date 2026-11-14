// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VehicleEscrow} from "../VehicleEscrow.sol";

/// @dev TEST HELPER ONLY. A buyer contract that tries to re-enter refund() when it receives money.
contract MaliciousBuyer {
    VehicleEscrow public immutable escrow;
    uint256 public dealId;
    uint256 public attempts;
    bool public reentrySucceeded;

    constructor(VehicleEscrow _escrow) {
        escrow = _escrow;
    }

    function lock(uint256 _dealId) external payable {
        dealId = _dealId;
        escrow.lockPayment{value: msg.value}(_dealId);
    }

    receive() external payable {
        attempts++;
        (bool ok,) = address(escrow).call(abi.encodeWithSelector(VehicleEscrow.refund.selector, dealId));
        if (ok) reentrySucceeded = true;
    }
}
