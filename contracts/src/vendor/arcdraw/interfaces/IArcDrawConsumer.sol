// Vendored from arc-randomness (ArcDraw) commit ad0cc7917a1b1dd7f934a8d3a9b489ca8add502d,
// path contracts/src/interfaces/IArcDrawConsumer.sol. Do not edit: bytes below this header are unchanged.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IArcDrawConsumer
/// @notice Callback interface invoked by the coordinator with at most `callbackGasLimit` gas.
///         A revert or out-of-gas in the callback does NOT revert fulfillment.
interface IArcDrawConsumer {
    function rawFulfillRandomness(uint256 requestId, bytes32 randomness) external;
}
