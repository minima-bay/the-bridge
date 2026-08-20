// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Disposable local-test readiness source. Never use as production authority.
contract MockAttestorBondReadiness {
    mapping(bytes32 => bool) public allBondsPosted;

    function setAllBondsPosted(bytes32 rosterHash, bool ready) external {
        allBondsPosted[rosterHash] = ready;
    }
}
