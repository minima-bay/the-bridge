// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./USDTmVaultV1.sol";

contract MockMinimaProofVerifier is IMinimaProofVerifier {
    struct Cancellation { bytes32 recordId; bytes32 messageId; uint128 amount; address recipient; bytes32 runtimeIdentity; bool settled; }
    struct Redemption { bytes32 redemptionId; uint128 amount; address recipient; bytes32 runtimeIdentity; bool settled; }
    mapping(bytes32=>Cancellation) public cancellations;
    mapping(bytes32=>Redemption) public redemptions;
    function setCancellation(bytes32 key,Cancellation calldata value) external { cancellations[key]=value; }
    function setRedemption(bytes32 key,Redemption calldata value) external { redemptions[key]=value; }
    function verifyCancellation(bytes calldata proof) external view returns(bytes32,bytes32,uint128,address,bytes32,bool){Cancellation memory v=cancellations[keccak256(proof)];return(v.recordId,v.messageId,v.amount,v.recipient,v.runtimeIdentity,v.settled);}
    function verifyRedemption(bytes calldata proof) external view returns(bytes32,uint128,address,bytes32,bool){Redemption memory v=redemptions[keccak256(proof)];return(v.redemptionId,v.amount,v.recipient,v.runtimeIdentity,v.settled);}
}
