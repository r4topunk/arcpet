// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {ArcPet} from "../../src/ArcPet.sol";
import {IArcPet} from "../../src/interfaces/IArcPet.sol";
import {IArcDrawConsumer} from "../../src/vendor/arcdraw/interfaces/IArcDrawConsumer.sol";
import {IArcDrawCoordinator} from "../../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {Quicknet} from "../fixtures/Quicknet.sol";

/// @notice ArcPet against the ArcDraw coordinator deployed on Arc mainnet. ArcPet is deployed inside the local fork
///         only; nothing is broadcast. Enable with ARC_FORK_TESTS=true (optional ARC_RPC_URL, ARC_FORK_BLOCK).
///         Skipped when disabled or when the RPC cannot be reached.
contract ArcPetForkTest is Test {
    IArcDrawCoordinator internal constant COORDINATOR = IArcDrawCoordinator(0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324);
    uint256 internal constant ARC_CHAIN_ID = 5042;
    uint256 internal constant DEFAULT_FORK_BLOCK = 21_338_100; // shortly after the coordinator deploy (21_338_070)

    bool internal enabled;
    ArcPet internal pet;
    address internal alice = makeAddr("alice");
    address internal relayer = makeAddr("relayer");

    function setUp() public {
        if (!vm.envOr("ARC_FORK_TESTS", false)) return;
        string memory rpc = vm.envOr("ARC_RPC_URL", string("https://rpc.mainnet.arc.io"));
        uint256 blockNumber = vm.envOr("ARC_FORK_BLOCK", DEFAULT_FORK_BLOCK);
        try vm.createSelectFork(rpc, blockNumber) {
            enabled = true;
        } catch {
            console2.log("Arc RPC unreachable; fork tests skipped");
            return;
        }
        pet = new ArcPet(COORDINATOR);
        // Rewind the local fork clock so a real past beacon (round 1_000_000) is the pinned round.
        vm.warp(COORDINATOR.roundTimestamp(Quicknet.ROUND_A - 4));
    }

    modifier onlyFork() {
        if (!enabled) {
            vm.skip(true);
            return;
        }
        _;
    }

    function _expected(uint256 requestId) internal pure returns (bytes32) {
        return keccak256(abi.encode(Quicknet.RAND_A, ARC_CHAIN_ID, address(COORDINATOR), requestId));
    }

    function test_fork_coordinatorFacts() public onlyFork {
        assertEq(block.chainid, ARC_CHAIN_ID);
        assertGt(address(COORDINATOR).code.length, 0);
        assertEq(COORDINATOR.MAX_CALLBACK_GAS_LIMIT(), 500_000);
        assertGe(COORDINATOR.MAX_CALLBACK_GAS_LIMIT(), pet.CALLBACK_GAS_LIMIT());
        assertEq(COORDINATOR.MIN_ROUND_DELAY(), 4);
    }

    function test_fork_hatchFulfillCallback() public onlyFork {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        IArcDrawCoordinator.Request memory r = COORDINATOR.getRequest(requestId);
        assertEq(r.requester, address(pet));
        assertEq(r.round, Quicknet.ROUND_A);
        assertEq(r.callbackGasLimit, 100_000);
        assertEq(r.bounty, 0);

        vm.warp(COORDINATOR.roundTimestamp(Quicknet.ROUND_A));
        vm.expectEmit(address(COORDINATOR));
        emit IArcDrawCoordinator.RandomnessFulfilled(
            requestId, Quicknet.ROUND_A, relayer, _expected(requestId), 0, true
        );
        vm.prank(relayer);
        uint256 g = gasleft();
        COORDINATOR.fulfill(requestId, Quicknet.SIG_A);
        console2.log("fork fulfill + ArcPet callback, gas:", g - gasleft());

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, _expected(requestId));
        assertEq(uint8(p.status), uint8(IArcPet.Status.Alive));
    }

    function test_fork_callbackFails_claimGenes() public onlyFork {
        vm.prank(alice);
        (uint256 id, uint256 requestId) = pet.hatch("Pixel");
        vm.warp(COORDINATOR.roundTimestamp(Quicknet.ROUND_A));

        vm.mockCallRevert(address(pet), abi.encodeWithSelector(IArcDrawConsumer.rawFulfillRandomness.selector), "");
        vm.expectEmit(address(COORDINATOR));
        emit IArcDrawCoordinator.RandomnessFulfilled(
            requestId, Quicknet.ROUND_A, relayer, _expected(requestId), 0, false
        );
        vm.prank(relayer);
        COORDINATOR.fulfill(requestId, Quicknet.SIG_A);
        vm.clearMockedCalls();

        assertEq(uint8(COORDINATOR.getRequest(requestId).status), uint8(IArcDrawCoordinator.Status.Fulfilled));
        assertEq(uint8(pet.petInfo(id).status), uint8(IArcPet.Status.Egg));

        pet.claimGenes(id);
        assertEq(pet.petInfo(id).genes, _expected(requestId));
        assertTrue(pet.isAlive(id));
        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyHatched.selector, id));
        pet.claimGenes(id);
    }
}
