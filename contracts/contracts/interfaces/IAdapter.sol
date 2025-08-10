// IAdapter.sol
pragma solidity ^0.8.24;

interface IAdapter {
  /// @dev asset must be approved to adapter before calling.
  function deposit(address asset, uint256 amount, address onBehalfOf, bytes calldata data) external;

  /// @dev withdraw asset to `to`. If protocol needs shares, pass via `data`.
  function withdraw(address asset, uint256 amount, address to, bytes calldata data) external;
}
