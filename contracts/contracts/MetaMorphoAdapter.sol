// MorphoAdapter.sol
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "./interfaces/IAdapter.sol";

interface IERC4626Like {
  function asset() external view returns (address);
  function mint(uint256 shares, address receiver) external returns (uint256 assets);
  function deposit(uint256 assets, address receiver) external returns (uint256 shares);
  function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
  function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
}

contract MorphoAdapter is Initializable, UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, IAdapter {
  using SafeERC20 for IERC20;

  address public vault;    // MetaMorpho (ERC4626-compatible) vault
  bool    public useMint;  // if true, treat `amount` as shares and call mint()

  function initialize(address owner_, address vault_, bool useMint_) public initializer {
    __Ownable2Step_init();
    __UUPSUpgradeable_init();
    __ReentrancyGuard_init();
    _transferOwnership(owner_);
    vault = vault_;
    useMint = useMint_;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  // Router must have transferred the underlying here first.
  // If useMint == true, `amount` is interpreted as desired shares (we still approve max of underlying).
  function deposit(address asset, uint256 amount, address onBehalfOf, bytes calldata) external nonReentrant {
    address underlying = IERC4626Like(vault).asset();
    require(underlying == asset, "adapter: asset mismatch");

    IERC20 token = IERC20(underlying);
    uint256 bal = token.balanceOf(address(this));
    require(bal > 0, "adapter: no funds");

    if (useMint) {
      // For mint(shares), vault will pull `previewMint(amount)` assets from msg.sender.
      _approveMaxIfNeeded(token, vault, bal);
      IERC4626Like(vault).mint(amount, onBehalfOf);
    } else {
      uint256 toDeposit = amount > bal ? bal : amount;
      require(toDeposit > 0, "adapter: nothing to deposit");
      _approveMaxIfNeeded(token, vault, toDeposit);
      IERC4626Like(vault).deposit(toDeposit, onBehalfOf);
    }
  }

  // Default: interpret `amount` as SHARES and redeem to `to` using owner=`to`.
  // If you prefer assets-based withdraw, switch to the withdraw() line and ensure `to` (owner)
  // has approved the adapter to spend their vault shares.
  function withdraw(address /*asset*/, uint256 amount, address to, bytes calldata) external nonReentrant {
    // shares path (default):
    IERC4626Like(vault).redeem(amount, to, to);

    // If you want assets-path instead, comment the line above and use:
    // IERC4626Like(vault).withdraw(amount, to, to);
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
