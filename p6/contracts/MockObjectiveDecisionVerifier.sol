// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Disposable deterministic challenge verifier for local work-record tests only.
/// @dev This is intentionally not a real fraud-proof programme. The fixed evidence tag proves only
///      that the recorder obeys its immutable verifier result.
contract MockObjectiveDecisionVerifier {
    bytes32 public constant INVALID_DECISION_EVIDENCE = keccak256("LOCAL_INVALID_DECISION_EVIDENCE_V1");

    function verifiesDecisionAccountability(
        bytes32,
        bytes32,
        bytes32,
        address,
        uint8,
        bytes calldata signature
    ) external pure returns (bool) {
        return signature.length != 0;
    }

    function provesInvalidDecision(
        bytes32,
        bytes32,
        bytes32,
        address,
        uint8,
        bytes32,
        bytes calldata evidence
    ) external pure returns (bool) {
        return keccak256(evidence) == INVALID_DECISION_EVIDENCE;
    }
}
