// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockNativeReceiver {
    enum Behavior { ACCEPT, REVERT, CALLBACK_AND_REQUIRE_SUCCESS }

    Behavior public behavior;
    address public callbackTarget;
    bytes public callbackData;

    function configure(Behavior behavior_, address callbackTarget_, bytes calldata callbackData_) external {
        behavior = behavior_;
        callbackTarget = callbackTarget_;
        callbackData = callbackData_;
    }

    receive() external payable {
        if (behavior == Behavior.REVERT) revert("receiver rejected");
        if (behavior == Behavior.CALLBACK_AND_REQUIRE_SUCCESS) {
            (bool success,) = callbackTarget.call(callbackData);
            require(success, "callback rejected");
        }
    }
}

contract ForceNative {
    constructor() payable {}

    function force(address payable target) external {
        selfdestruct(target);
    }
}
