// AaveAdapter.sol
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "./interfaces/IAdapter.sol";

interface IAavePool {
  function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
  function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract AaveAdapter is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, IAdapter {
  using SafeERC20 for IERC20;

  address public aavePool; // chain-specific

  function initialize(address owner_, address aavePool_) public initializer {
      require(msg.sender == 0xF20a5e1a4ca28D64f2C4A90998A41E8045288F48, "You aint hijacking this");
    __Ownable2Step_init();
    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();
    _transferOwnership(owner_);
    aavePool = aavePool_;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

   function deposit(address asset, uint256 amount, address onBehalfOf, bytes calldata) external nonReentrant {
    IERC20 token = IERC20(asset);

    // Use what's actually here; tolerate tiny deltas
    uint256 bal = token.balanceOf(address(this));
    uint256 toSupply = amount > bal ? bal : amount;
    require(toSupply > 0, "adapter: no funds");

    _approveMaxIfNeeded(token, aavePool, toSupply);
    IAavePool(aavePool).supply(asset, toSupply, onBehalfOf, 0);
  }

  function withdraw(address asset, uint256 amount, address to, bytes calldata) external nonReentrant {
    IAavePool(aavePool).withdraw(asset, amount, to);
  }

   function _approveMaxIfNeeded(IERC20 token, address spender, uint256 needed) internal {
    uint256 curr = token.allowance(address(this), spender);
    if (curr < needed) {
      if (curr != 0) token.approve(spender, 0); // USDT-style reset safety
      token.approve(spender, type(uint256).max);
    }
  }

  uint256[50] private __gap;
}
