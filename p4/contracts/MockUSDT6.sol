// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockUSDT6 {
    string public constant name = "Valueless Mock USDT";
    string public constant symbol = "mUSDT6";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint16 public feeBasisPoints;
    uint8 public behavior;
    address public callbackTarget;
    bytes public callbackData;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function configure(uint16 feeBasisPoints_, uint8 behavior_, address callbackTarget_, bytes calldata callbackData_) external { feeBasisPoints=feeBasisPoints_;behavior=behavior_;callbackTarget=callbackTarget_;callbackData=callbackData_; }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed=allowance[from][msg.sender];require(allowed>=amount,"allowance");allowance[from][msg.sender]=allowed-amount;return _move(from,to,amount);
    }
    function transfer(address to, uint256 amount) external returns (bool) { return _move(msg.sender,to,amount); }
    function _move(address from,address to,uint256 amount) private returns(bool){
        if(behavior==2)revert("mock revert");if(behavior==1)return false;require(balanceOf[from]>=amount,"balance");balanceOf[from]-=amount;uint256 received=amount-(amount*feeBasisPoints/10000);balanceOf[to]+=received;
        if(callbackTarget!=address(0)){(bool ok,)=callbackTarget.call(callbackData);require(ok,"callback");}
        if(behavior==3){assembly{return(0,0)}}return true;
    }
}
