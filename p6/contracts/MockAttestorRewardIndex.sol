// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Disposable no-op reward checkpoint for tests that do not exercise reward indexing.
contract MockAttestorRewardIndex {
    function beforeBondChange(bytes32, address, address, uint256) external pure {}
}
