// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ArcPet} from "../../src/ArcPet.sol";
import {IArcPet} from "../../src/interfaces/IArcPet.sol";
import {IArcDrawCoordinator} from "../../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {TestCoordinator, fakeSignature} from "../vendor/arcdraw/TestCoordinator.sol";

/// @notice ArcPet wired to the production ArcDraw coordinator code with the BLS pairing swapped for a deterministic
///         fake signature per round (TestCoordinator). Real-beacon coverage: ArcPetRealCoordinator.t.sol and fork/.
abstract contract ArcPetBase is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000; // untouched: bounty is 0
    uint64 internal constant START = 1_789_625_579; // Arc mainnet block timestamp, 2026-09-17

    TestCoordinator internal coord;
    ArcPet internal pet;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public virtual {
        vm.warp(START);
        coord = new TestCoordinator(ARC_USDC);
        pet = new ArcPet(IArcDrawCoordinator(address(coord)));
    }

    // ---------------------------------------------------------------- helpers

    function _hatch(address who, string memory n) internal returns (uint256 id, uint256 requestId) {
        vm.prank(who);
        (id, requestId) = pet.hatch(n);
    }

    /// @dev Fulfills through the coordinator (the real callback path), warping to the pinned round if needed.
    function _fulfill(uint256 requestId) internal {
        uint64 round = coord.getRequest(requestId).round;
        uint64 ts = coord.roundTimestamp(round);
        if (block.timestamp < ts) vm.warp(ts);
        coord.fulfill(requestId, fakeSignature(round));
    }

    /// @dev Delivers chosen genes straight to the callback, as the coordinator would.
    function _deliver(uint256 requestId, bytes32 genes) internal {
        vm.prank(address(coord));
        pet.rawFulfillRandomness(requestId, genes);
    }

    function _born(address who) internal returns (uint256 id) {
        uint256 requestId;
        (id, requestId) = _hatch(who, "Pixel");
        _fulfill(requestId);
    }

    function _bornWith(address who, bytes32 genes) internal returns (uint256 id) {
        uint256 requestId;
        (id, requestId) = _hatch(who, "Pixel");
        _deliver(requestId, genes);
    }

    function _randomnessOf(uint256 requestId) internal view returns (bytes32) {
        uint64 round = coord.getRequest(requestId).round;
        return keccak256(abi.encode(sha256(fakeSignature(round)), block.chainid, address(coord), requestId));
    }

    function _status(uint256 id) internal view returns (IArcPet.Status) {
        return pet.petInfo(id).status;
    }

    /// @dev genes with the given hunger / play genes and cosmetic bits.
    function _genes(uint8 hg, uint8 pg, uint8 cosmetic) internal pure returns (bytes32) {
        return bytes32((uint256(pg) << 16) | (uint256(hg) << 8) | uint256(cosmetic & 0x7f));
    }
}
