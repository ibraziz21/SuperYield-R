// CometAdapter.sol
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "./interfaces/IAdapter.sol";

interface IComet {
  function supply(address asset, uint256 amount) external;
  function withdraw(address asset, uint256 amount) external;
}

contract CometAdapter is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, IAdapter {
  using SafeERC20 for IERC20;

  address public comet; // Compound v3 Comet core

  function initialize(address owner_, address comet_) public initializer {
    require(msg.sender == 0xF20a5e1a4ca28D64f2C4A90998A41E8045288F48, "You aint hijacking this");
    __Ownable2Step_init();
    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();
    _transferOwnership(owner_);
    comet = comet_;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  // Router must have transferred `asset` here first.
  function deposit(address asset, uint256 amount, address /*onBehalfOf*/, bytes calldata) external nonReentrant {
    IERC20 token = IERC20(asset);

    uint256 bal = token.balanceOf(address(this));
    uint256 toSupply = amount > bal ? bal : amount;
    require(toSupply > 0, "adapter: no funds");

    _approveMaxIfNeeded(token, comet, toSupply);
    IComet(comet).supply(asset, toSupply);
  }

  // Withdraw comes back to the adapter (msg.sender), then we forward exact received to `to`.
  function withdraw(address asset, uint256 amount, address to, bytes calldata) external nonReentrant {
    IERC20 token = IERC20(asset);

    uint256 beforeBal = token.balanceOf(address(this));
    IComet(comet).withdraw(asset, amount);
    uint256 received = token.balanceOf(address(this)) - beforeBal;
    require(received > 0, "adapter: no withdrawal");

    token.safeTransfer(to, received);
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
