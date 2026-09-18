// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {ArcPet} from "../src/ArcPet.sol";
import {IArcPet} from "../src/interfaces/IArcPet.sol";
import {IArcDrawConsumer} from "../src/vendor/arcdraw/interfaces/IArcDrawConsumer.sol";
import {IArcDrawCoordinator} from "../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {ArcDrawCoordinator} from "./vendor/arcdraw/ArcDrawCoordinator.sol";
import {Quicknet} from "./fixtures/Quicknet.sol";

/// @dev Stands in for ArcPet's code during one fulfill to force an out-of-gas callback.
contract GasBurner {
    fallback() external {
        while (true) {}
    }
}

/// @notice ArcPet against the production ArcDrawCoordinator (real BLS verification via EIP-2537) and real drand
///         quicknet beacons. Covers R2 (callback failure is swallowed -> claimGenes) and R8 (refunded still hatches).
contract ArcPetRealCoordinatorTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000; // untouched: bounty is 0

    ArcDrawCoordinator internal coord;
    ArcPet internal pet;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal relayer = makeAddr("relayer");

    function setUp() public {
        coord = new ArcDrawCoordinator(ARC_USDC);
        pet = new ArcPet(IArcDrawCoordinator(address(coord)));
        // First moment round 1_000_000 can be pinned (MIN_ROUND_DELAY = 4).
        vm.warp(coord.roundTimestamp(Quicknet.ROUND_A - 4));
        assertEq(coord.minRequestRound(), Quicknet.ROUND_A);
    }

    function _expected(uint256 requestId) internal view returns (bytes32) {
        return keccak256(abi.encode(Quicknet.RAND_A, block.chainid, address(coord), requestId));
    }

    function test_real_hatchAndFulfillRunsCallback() public {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        assertEq(coord.getRequest(requestId).round, Quicknet.ROUND_A);

        vm.warp(coord.roundTimestamp(Quicknet.ROUND_A));
        bytes32 genes = _expected(requestId);
        vm.expectEmit(address(coord));
        emit IArcDrawCoordinator.RandomnessFulfilled(requestId, Quicknet.ROUND_A, relayer, genes, 0, true);
        vm.prank(relayer);
        uint256 g = gasleft();
        coord.fulfill(requestId, Quicknet.SIG_A);
        console2.log("real fulfill (BLS verify + ArcPet callback), gas:", g - gasleft());

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, genes);
        assertEq(p.bornAt, block.timestamp);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Alive));
    }

    function test_real_callbackReverts_thenClaimGenes() public {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        vm.warp(coord.roundTimestamp(Quicknet.ROUND_A));

        vm.mockCallRevert(address(pet), abi.encodeWithSelector(IArcDrawConsumer.rawFulfillRandomness.selector), "boom");
        vm.expectEmit(address(coord));
        emit IArcDrawCoordinator.RandomnessFulfilled(
            requestId, Quicknet.ROUND_A, relayer, _expected(requestId), 0, false
        );
        vm.prank(relayer);
        coord.fulfill(requestId, Quicknet.SIG_A);
        vm.clearMockedCalls();

        _assertStuckThenClaim(id, requestId);
    }

    function test_real_callbackOutOfGas_thenClaimGenes() public {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        vm.warp(coord.roundTimestamp(Quicknet.ROUND_A));

        bytes memory code = address(pet).code;
        vm.etch(address(pet), address(new GasBurner()).code);
        vm.prank(relayer);
        coord.fulfill{gas: 2_000_000}(requestId, Quicknet.SIG_A); // burner eats all 100k; fulfill still succeeds
        vm.etch(address(pet), code);

        _assertStuckThenClaim(id, requestId);
    }

    /// @notice R8: an expired + refunded request is still fulfilled with the real beacon, and the egg hatches.
    function test_real_refundedRequestStillHatches() public {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        vm.warp(coord.expiresAt(requestId) + 180 days);
        coord.refund(requestId);
        assertEq(uint8(coord.getRequest(requestId).status), uint8(IArcDrawCoordinator.Status.Refunded));

        vm.prank(relayer);
        coord.fulfill(requestId, Quicknet.SIG_A);
        assertEq(pet.petInfo(id).genes, _expected(requestId));
        assertTrue(pet.isAlive(id));
    }

    /// @notice Two eggs pinned to the same round are hatched by one verification, with different genes.
    function test_real_batchHatchesTwoEggs() public {
        vm.prank(alice);
        (uint256 a, uint256 ra) = pet.hatch("A");
        vm.prank(bob);
        (uint256 b, uint256 rb) = pet.hatch("B");
        vm.warp(coord.roundTimestamp(Quicknet.ROUND_A));

        uint256[] memory ids = new uint256[](2);
        ids[0] = ra;
        ids[1] = rb;
        coord.fulfillBatch(Quicknet.ROUND_A, Quicknet.SIG_A, ids);

        assertEq(pet.petInfo(a).genes, _expected(ra));
        assertEq(pet.petInfo(b).genes, _expected(rb));
        assertTrue(pet.petInfo(a).genes != pet.petInfo(b).genes);
    }

    /// @notice SPEC §2.2 / PetLib header: genes are the per-request derivation, not the raw drand randomness.
    function test_real_genesArePerRequestDerivation() public {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        vm.warp(coord.roundTimestamp(Quicknet.ROUND_A));
        coord.fulfill(requestId, Quicknet.SIG_A);

        bytes32 drandRandomness = sha256(Quicknet.SIG_A);
        assertEq(drandRandomness, Quicknet.RAND_A);
        bytes32 genes = pet.petInfo(id).genes;
        assertTrue(genes != drandRandomness, "genes are not sha256(signature)");
        assertEq(genes, keccak256(abi.encode(drandRandomness, block.chainid, address(coord), requestId)));
        assertEq(coord.getRequest(requestId).randomness, genes);
    }

    function _assertStuckThenClaim(uint256 id, uint256 requestId) internal {
        IArcDrawCoordinator.Request memory r = coord.getRequest(requestId);
        assertEq(uint8(r.status), uint8(IArcDrawCoordinator.Status.Fulfilled), "coordinator marks Fulfilled anyway");
        assertEq(r.randomness, _expected(requestId));
        assertEq(uint8(pet.petInfo(id).status), uint8(IArcPet.Status.Egg), "egg is stuck without claimGenes");

        vm.expectRevert(
            abi.encodeWithSelector(
                IArcDrawCoordinator.RequestNotFulfillable.selector, requestId, IArcDrawCoordinator.Status.Fulfilled
            )
        );
        coord.fulfill(requestId, Quicknet.SIG_A); // no second callback is possible

        vm.warp(block.timestamp + 7 days);
        uint64 t = uint64(block.timestamp);
        vm.expectEmit(address(pet));
        emit IArcPet.Hatched(id, r.randomness, t, _deathAtFor(r.randomness, t), true);
        vm.prank(bob); // permissionless
        pet.claimGenes(id);

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, r.randomness);
        assertEq(p.bornAt, block.timestamp);
        assertTrue(pet.isAlive(id));

        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyHatched.selector, id));
        pet.claimGenes(id);

        // the wallet is unblocked: once this pet dies, alice can hatch again
        vm.warp(p.deathAt);
        vm.prank(alice);
        pet.hatch("Next");
        assertEq(pet.petOf(alice), id + 1);
    }

    function _deathAtFor(bytes32 genes, uint64 t) internal pure returns (uint64) {
        uint64 th = uint64((86_400 * (8000 + (((uint256(genes) >> 8) & 0xff) * 4000) / 255)) / 10_000);
        uint64 tp = uint64((172_800 * (8000 + (((uint256(genes) >> 16) & 0xff) * 4000) / 255)) / 10_000);
        return t + (th < tp ? th : tp);
    }
}
