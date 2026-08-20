// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMockExposureController {
    function increaseLiability(bytes32 settlementId, uint256 amount) external;
    function releaseLiability(bytes32 resolutionId, uint256 amount) external;
}

/// @notice Disposable lane caller for local aggregate-exposure tests only.
contract MockExposureLane {
    IMockExposureController public immutable controller;
    bytes32 public immutable laneId;

    constructor(address controller_, bytes32 laneId_) {
        controller = IMockExposureController(controller_);
        laneId = laneId_;
    }

    function increase(bytes32 settlementId, uint256 amount) external {
        controller.increaseLiability(settlementId, amount);
    }

    function release(bytes32 resolutionId, uint256 amount) external {
        controller.releaseLiability(resolutionId, amount);
    }
}
