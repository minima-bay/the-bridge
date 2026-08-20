// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Disposable ERC-20-like token for local bond-vault tests only.
contract MockValuelessBondToken {
    string public constant name = "Valueless Bond Fixture";
    string public constant symbol = "VBOND";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public feeBps;
    uint8 public behavior;
    address public callbackTarget;
    bytes public callbackData;

    error InsufficientBalance();
    error InsufficientAllowance();
    error ConfiguredRevert();
    error CallbackFailed();
    error InvalidFee();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function configure(uint256 feeBps_, uint8 behavior_, address callbackTarget_, bytes calldata callbackData_) external {
        if (feeBps_ > 10_000) revert InvalidFee();
        feeBps = feeBps_;
        behavior = behavior_;
        callbackTarget = callbackTarget_;
        callbackData = callbackData_;
    }

    function mint(address recipient, uint256 amount) external {
        totalSupply += amount;
        balanceOf[recipient] += amount;
        emit Transfer(address(0), recipient, amount);
    }

    function confiscate(address holder, uint256 amount) external {
        if (balanceOf[holder] < amount) revert InsufficientBalance();
        balanceOf[holder] -= amount;
        totalSupply -= amount;
        emit Transfer(holder, address(0), amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (behavior == 1) return false;
        if (behavior == 2) revert ConfiguredRevert();
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        uint256 fee = amount * feeBps / 10_000;
        uint256 received = amount - fee;
        balanceOf[to] += received;
        totalSupply -= fee;
        emit Transfer(from, to, received);
        if (fee != 0) emit Transfer(from, address(0), fee);

        if (callbackTarget != address(0)) {
            (bool success,) = callbackTarget.call(callbackData);
            if (!success) revert CallbackFailed();
        }
        if (behavior == 3) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}
