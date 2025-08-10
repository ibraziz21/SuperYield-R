// AggregatorRouter.sol
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAdapter} from "./interfaces/IAdapter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";



contract AggregatorRouter is
  Initializable,
  UUPSUpgradeable,
  Ownable2StepUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable
{
  using SafeERC20 for IERC20;

  // e.g. keccak256("aave-v3:optimism"), keccak256("compound-v3:base"), keccak256("morpho:lisk")
  mapping(bytes32 => address) public adapters;

  address public feeTreasury;
  uint16  public feeBps; // 10 = 0.10%

  event AdapterRegistered(bytes32 indexed key, address adapter);
  event FeeUpdated(uint16 feeBps, address feeTreasury);
  event Deposited(bytes32 indexed key, address indexed user, address asset, uint256 gross, uint256 fee, uint256 net);
  event Withdrawn(bytes32 indexed key, address indexed user, address asset, uint256 amount);

  function initialize(address owner_, address feeTreasury_, uint16 feeBps_) public initializer {
    __Ownable2Step_init();
    __UUPSUpgradeable_init();
    __Pausable_init();
    __ReentrancyGuard_init();
    _transferOwnership(owner_);
    feeTreasury = feeTreasury_;
    feeBps = feeBps_;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  // --- Admin ---
  function setFee(uint16 newFeeBps, address newTreasury) external onlyOwner {
    require(newTreasury != address(0), "treasury=0");
    require(newFeeBps <= 1000, "fee too high"); // 10% hard cap safety
    feeBps = newFeeBps;
    feeTreasury = newTreasury;
    emit FeeUpdated(newFeeBps, newTreasury);
  }

  function registerAdapter(bytes32 key, address adapter) external onlyOwner {
    require(adapter != address(0), "adapter=0");
    adapters[key] = adapter;
    emit AdapterRegistered(key, adapter);
  }

  function pause() external onlyOwner { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

function deposit(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes calldata data)
  external
  nonReentrant
  whenNotPaused
{
  address adapter = adapters[key];
  require(adapter != address(0), "adapter not set");

  IERC20 t = IERC20(asset);
  t.safeTransferFrom(msg.sender, address(this), amount);

  uint256 fee = (amount * feeBps) / 10_000;
  if (fee > 0) t.safeTransfer(feeTreasury, fee);
  uint256 net = amount - fee;

  // push tokens to adapter; compute exact received (FoT-safe)
  uint256 before = t.balanceOf(adapter);
  t.safeTransfer(adapter, net);
  uint256 received = t.balanceOf(adapter) - before;
  require(received > 0, "router: no tokens received");

  IAdapter(adapter).deposit(asset, received, onBehalfOf, data);

  emit Deposited(key, msg.sender, asset, amount, fee, received);
}

  function withdraw(bytes32 key, address asset, uint256 amount, address to, bytes calldata data)
    external
    nonReentrant
    whenNotPaused
  {
    address adapter = adapters[key];
    require(adapter != address(0), "adapter not set");

    // In most venues, the adapter will handle msg.sender auth (e.g. withdraw on behalf).
    // If your adapter needs to hold positions, you gate it internally by msg.sender.
    IAdapter(adapter).withdraw(asset, amount, to, data);

    emit Withdrawn(key, msg.sender, asset, amount);
  }

  uint256[50] private __gap;
}
