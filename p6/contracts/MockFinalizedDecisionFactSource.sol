// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Disposable mutable fact-source adapter for local verifier tests only.
/// @dev This contract does not verify Ethereum or Minima consensus and is never production authority.
contract MockFinalizedDecisionFactSource {
    struct Fact {
        bytes32 rosterHash;
        bytes32 requestId;
        bytes32 requestDigest;
        uint8 correctDecision;
        bytes32 factDigest;
        bool finalized;
    }

    mapping(bytes32 => Fact) public facts;

    function setFact(bytes32 proofKey, Fact calldata fact) external {
        facts[proofKey] = fact;
    }

    function verifyFinalizedDecision(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        bytes calldata proof
    ) external view returns (bool finalized, uint8 correctDecision, bytes32 factDigest) {
        Fact memory fact = facts[keccak256(proof)];
        bool exact =
            fact.rosterHash == rosterHash &&
            fact.requestId == requestId &&
            fact.requestDigest == requestDigest;
        return (exact && fact.finalized, fact.correctDecision, fact.factDigest);
    }
}
