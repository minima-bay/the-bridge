// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IFinalizedDecisionFactSource {
    function verifyFinalizedDecision(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        bytes calldata proof
    ) external view returns (bool finalized, uint8 correctDecision, bytes32 factDigest);
}

/// @notice Immutable verifier for two narrowly objective attestor-decision fault programmes.
/// @dev Programme 1 delegates exact finalized truth to one immutable fact source. Programme 2
///      proves same-domain accountability equivocation with two conflicting EIP-712 signatures.
///      This contract holds no assets and has no owner, administrator or upgrade function.
contract ObjectiveDecisionVerifierV1 {
    uint8 public constant DECISION_APPROVE = 1;
    uint8 public constant DECISION_REJECT = 2;
    uint8 public constant PROGRAMME_FINALIZED_FACT_CONTRADICTION = 1;
    uint8 public constant PROGRAMME_ACCOUNTABILITY_EQUIVOCATION = 2;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant DECISION_TYPEHASH = keccak256(
        "Decision(bytes32 rosterHash,address workRecorder,bytes32 requestId,bytes32 requestDigest,uint8 decision)"
    );
    bytes32 public constant NAME_HASH = keccak256("CanonicalBridgeObjectiveDecisionVerifier");
    bytes32 public constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    IFinalizedDecisionFactSource public immutable factSource;
    address public immutable workRecorder;

    error InvalidFactSource();
    error InvalidWorkRecorder();

    constructor(address factSourceAddress, address workRecorderAddress) {
        if (factSourceAddress == address(0) || factSourceAddress.code.length == 0) {
            revert InvalidFactSource();
        }
        if (workRecorderAddress == address(0)) revert InvalidWorkRecorder();
        factSource = IFinalizedDecisionFactSource(factSourceAddress);
        workRecorder = workRecorderAddress;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function decisionDigest(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        uint8 decision
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                DECISION_TYPEHASH,
                rosterHash,
                workRecorder,
                requestId,
                requestDigest,
                decision
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function verifiesDecisionAccountability(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        address member,
        uint8 decision,
        bytes calldata signature
    ) external view returns (bool) {
        return
            msg.sender == workRecorder &&
            rosterHash != bytes32(0) &&
            requestId != bytes32(0) &&
            requestDigest != bytes32(0) &&
            member != address(0) &&
            _validDecision(decision) &&
            _recover(decisionDigest(rosterHash, requestId, requestDigest, decision), signature) == member;
    }

    function provesInvalidDecision(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        address member,
        uint8 decision,
        bytes32,
        bytes calldata evidence
    ) external view returns (bool) {
        if (
            msg.sender != workRecorder ||
            rosterHash == bytes32(0) ||
            requestId == bytes32(0) ||
            requestDigest == bytes32(0) ||
            member == address(0) ||
            !_validDecision(decision) ||
            evidence.length == 0
        ) return false;

        uint8 programme = uint8(evidence[0]);
        if (programme == PROGRAMME_FINALIZED_FACT_CONTRADICTION) {
            return _provesFinalizedFactContradiction(
                rosterHash,
                requestId,
                requestDigest,
                decision,
                evidence[1:]
            );
        }
        if (programme == PROGRAMME_ACCOUNTABILITY_EQUIVOCATION) {
            return _provesAccountabilityEquivocation(
                rosterHash,
                requestId,
                requestDigest,
                member,
                evidence
            );
        }
        return false;
    }

    function _provesFinalizedFactContradiction(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        uint8 decision,
        bytes calldata proof
    ) private view returns (bool) {
        if (proof.length == 0) return false;
        try factSource.verifyFinalizedDecision(rosterHash, requestId, requestDigest, proof) returns (
            bool finalized,
            uint8 correctDecision,
            bytes32 factDigest
        ) {
            return
                finalized &&
                factDigest != bytes32(0) &&
                _validDecision(correctDecision) &&
                correctDecision != decision;
        } catch {
            return false;
        }
    }

    function _provesAccountabilityEquivocation(
        bytes32 rosterHash,
        bytes32 requestId,
        bytes32 requestDigest,
        address member,
        bytes calldata evidence
    ) private view returns (bool) {
        if (evidence.length != 131) return false;
        bytes32 approveDigest = decisionDigest(
            rosterHash,
            requestId,
            requestDigest,
            DECISION_APPROVE
        );
        bytes32 rejectDigest = decisionDigest(
            rosterHash,
            requestId,
            requestDigest,
            DECISION_REJECT
        );
        return
            _recover(approveDigest, evidence[1:66]) == member &&
            _recover(rejectDigest, evidence[66:131]) == member;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) return address(0);
        signer = ecrecover(digest, v, r, s);
    }

    function _validDecision(uint8 decision) private pure returns (bool) {
        return decision == DECISION_APPROVE || decision == DECISION_REJECT;
    }
}
