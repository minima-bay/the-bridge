// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMockFeeExposureController {
    function increaseLiability(bytes32 settlementId, uint256 amount) external;
}

interface IMockFeeTreasury {
    function collectConfirmedFee(bytes32 settlementId, uint256 feeAmount) external;
}

interface IMockFeeToken {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IMockWorkRecorder {
    function registerRequest(bytes32 requestId, bytes32 requestDigest, uint256 decisionDeadline) external;
}

/// @notice Disposable atomic liability-and-fee lane for local treasury tests only.
contract MockFeeLane {
    IMockFeeExposureController public immutable controller;
    bytes32 public immutable laneId;

    constructor(address controller_, bytes32 laneId_) {
        controller = IMockFeeExposureController(controller_);
        laneId = laneId_;
    }

    function settleAndCollect(
        address treasury,
        address feeAsset,
        bytes32 settlementId,
        uint256 principal,
        uint256 fee
    ) external {
        controller.increaseLiability(settlementId, principal);
        IMockFeeToken(feeAsset).approve(treasury, fee);
        IMockFeeTreasury(treasury).collectConfirmedFee(settlementId, fee);
    }

    function confirmOnly(bytes32 settlementId, uint256 principal) external {
        controller.increaseLiability(settlementId, principal);
    }

    function collectExisting(address treasury, address feeAsset, bytes32 settlementId, uint256 fee) external {
        IMockFeeToken(feeAsset).approve(treasury, fee);
        IMockFeeTreasury(treasury).collectConfirmedFee(settlementId, fee);
    }

    function registerWorkRequest(
        address workRecorder,
        bytes32 requestId,
        bytes32 requestDigest,
        uint256 decisionDeadline
    ) external {
        IMockWorkRecorder(workRecorder).registerRequest(requestId, requestDigest, decisionDeadline);
    }
}
