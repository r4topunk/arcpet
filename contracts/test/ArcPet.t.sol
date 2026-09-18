// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IERC165} from "forge-std/interfaces/IERC165.sol";
import {IERC721, IERC721Metadata} from "forge-std/interfaces/IERC721.sol";
import {ArcPetBase} from "./utils/ArcPetBase.sol";
import {ArcDrawConsumer} from "../src/vendor/arcdraw/ArcDrawConsumer.sol";
import {IArcDrawConsumer} from "../src/vendor/arcdraw/interfaces/IArcDrawConsumer.sol";
import {IArcDrawCoordinator} from "../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {IArcPet} from "../src/interfaces/IArcPet.sol";
import {PetLib} from "../src/libraries/PetLib.sol";

/// @notice Unit tests: every row of SPEC §2.1 (effects, events, each revert and its order), soulbound surface,
///         ERC-165, and the petInfo view in every status.
contract ArcPetTest is ArcPetBase {
    // hg = 0 -> TH = 69_120 s, pg = 255 -> TP = 207_360 s: hunger decides death unless the pet is fed.
    bytes32 internal constant FAST_HUNGER = bytes32(uint256(255) << 16);
    uint32 internal constant TH_MIN = 69_120;
    uint32 internal constant TP_MAX = 207_360;

    // ================================================================ hatch

    function test_hatch_mintsEggAndRequestsRandomness() public {
        uint64 round = coord.minRequestRound();
        vm.expectEmit(address(pet));
        emit IArcPet.Transfer(address(0), alice, 1);
        vm.expectEmit(address(pet));
        emit IArcPet.Locked(1);
        vm.expectEmit(address(pet));
        emit IArcPet.EggLaid(1, alice, 1, round, "Pixel");
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");

        assertEq(id, 1);
        assertEq(requestId, 1);
        assertEq(pet.totalSupply(), 1);
        assertEq(pet.petOf(alice), 1);
        assertEq(pet.petByRequest(1), 1);
        assertEq(pet.ownerOf(1), alice);
        assertEq(pet.balanceOf(alice), 1);

        IArcDrawCoordinator.Request memory r = coord.getRequest(requestId);
        assertEq(r.requester, address(pet));
        assertEq(r.callbackGasLimit, 100_000);
        assertEq(r.callbackGasLimit, pet.CALLBACK_GAS_LIMIT());
        assertEq(r.bounty, 0);
        assertEq(r.round, round);
        assertEq(uint8(r.status), uint8(IArcDrawCoordinator.Status.Pending));
    }

    function test_hatch_eggInfo() public {
        _hatch(alice, "Pixel");
        vm.warp(block.timestamp + 365 days); // eggs never decay or expire
        IArcPet.PetInfo memory p = pet.petInfo(1);
        assertEq(p.id, 1);
        assertEq(p.owner, alice);
        assertEq(p.name, "Pixel");
        assertEq(p.genes, bytes32(0));
        assertEq(p.requestId, 1);
        assertEq(p.laidAt, START);
        assertEq(p.bornAt, 0);
        assertEq(p.lastFed, 0);
        assertEq(p.lastPlayed, 0);
        assertEq(p.diedAt, 0);
        assertEq(p.hungerWindow, 0);
        assertEq(p.playWindow, 0);
        assertEq(p.asOf, block.timestamp);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Egg));
        assertEq(uint8(p.mood), uint8(IArcPet.Mood.Egg));
        assertEq(p.deathAt, 0);
        assertEq(p.age, 0);
        assertEq(p.hunger, 100);
        assertEq(p.happiness, 100);
        assertEq(p.species + p.palette + p.eyes, 0);
        assertFalse(pet.isAlive(1));
        assertEq(pet.deathAt(1), 0);
    }

    function test_hatch_acceptsTwentyBytePrintableName() public {
        (uint256 id,) = _hatch(alice, "Mr. Whiskers 2026 ok");
        assertEq(bytes(pet.petInfo(id).name).length, 20);
    }

    function test_hatch_rejectsInvalidNames() public {
        string[7] memory bad = [
            "",
            "123456789012345678901", // 21 bytes
            "a<b",
            "tom & jerry",
            "quote\"",
            "back\\slash",
            unicode"Zé" // non-ASCII
        ];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(IArcPet.InvalidName.selector);
            pet.hatch(bad[i]);
        }
        assertEq(pet.totalSupply(), 0);
        assertEq(coord.requestCount(), 0);
    }

    function test_hatch_revertsWhileEgg() public {
        _hatch(alice, "Pixel");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyHasPet.selector, alice, 1));
        pet.hatch("Again");
    }

    function test_hatch_revertsWhileAlive() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id) - 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyHasPet.selector, alice, id));
        pet.hatch("Again");
    }

    function test_hatch_nameCheckedBeforeOwnership() public {
        _hatch(alice, "Pixel");
        vm.prank(alice);
        vm.expectRevert(IArcPet.InvalidName.selector);
        pet.hatch("");
    }

    function test_hatch_autoBuriesDeadPet() public {
        uint256 id = _born(alice);
        uint64 d = pet.deathAt(id);
        uint64 bornAt = pet.petInfo(id).bornAt;
        vm.warp(d + 3 days);

        vm.expectEmit(address(pet));
        emit IArcPet.Died(id, alice, d, d - bornAt);
        vm.expectEmit(address(pet));
        emit IArcPet.Transfer(address(0), alice, 2);
        (uint256 id2,) = _hatch(alice, "Second");

        assertEq(id2, 2);
        assertEq(pet.petOf(alice), 2);
        assertEq(pet.balanceOf(alice), 2);
        IArcPet.PetInfo memory old = pet.petInfo(id);
        assertEq(uint8(old.status), uint8(IArcPet.Status.Buried));
        assertEq(old.diedAt, d);
        assertEq(old.age, d - bornAt);
    }

    function test_hatch_afterBuriedDoesNotBuryAgain() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id));
        vm.prank(bob);
        pet.bury(id);

        vm.recordLogs();
        _hatch(alice, "Second");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != IArcPet.Died.selector, "no second Died");
        }
    }

    function test_hatch_oneLivingPetPerWalletIsIndependentAcrossWallets() public {
        (uint256 a,) = _hatch(alice, "A");
        (uint256 b,) = _hatch(bob, "B");
        (uint256 c,) = _hatch(carol, "C");
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(c, 3);
        assertEq(pet.totalSupply(), 3);
        assertEq(pet.petByRequest(2), 2);
        assertEq(pet.petByRequest(99), 0);
        assertEq(pet.petOf(makeAddr("nobody")), 0);
    }

    // ================================================================ callback

    function test_callback_setsGenesAndBirth() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        uint64 round = coord.getRequest(requestId).round;
        vm.warp(coord.roundTimestamp(round));
        bytes32 genes = _randomnessOf(requestId);
        uint32 th = PetLib.hungerWindow(genes);
        uint32 tp = PetLib.playWindow(genes);
        uint64 t = uint64(block.timestamp);

        vm.expectEmit(address(pet));
        emit IArcPet.Hatched(id, genes, t, PetLib.deathAt(t, t, th, tp), false);
        vm.expectEmit(address(coord));
        emit IArcDrawCoordinator.RandomnessFulfilled(requestId, round, address(this), genes, 0, true);
        _fulfill(requestId);

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, genes);
        assertEq(p.bornAt, t);
        assertEq(p.lastFed, t);
        assertEq(p.lastPlayed, t);
        assertEq(p.hungerWindow, th);
        assertEq(p.playWindow, tp);
        assertEq(p.deathAt, t + (th < tp ? th : tp));
        assertEq(uint8(p.status), uint8(IArcPet.Status.Alive));
        assertEq(uint8(p.mood), uint8(IArcPet.Mood.Happy));
        assertEq(p.hunger, 100);
        assertEq(p.happiness, 100);
        assertEq(p.age, 0);
        assertEq(p.species, PetLib.species(genes));
        assertEq(p.palette, PetLib.palette(genes));
        assertEq(p.eyes, PetLib.eyes(genes));
        assertTrue(pet.isAlive(id));
    }

    function test_callback_onlyCoordinator() public {
        (, uint256 requestId) = _hatch(alice, "Pixel");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ArcDrawConsumer.OnlyCoordinator.selector, bob));
        pet.rawFulfillRandomness(requestId, bytes32(uint256(1)));
    }

    function test_callback_unknownRequestIsNoop() public {
        _deliver(12345, bytes32(uint256(7)));
        assertEq(pet.totalSupply(), 0);
    }

    function test_callback_neverOverwritesGenes() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        _deliver(requestId, bytes32(uint256(0xAAAA)));
        uint64 bornAt = pet.petInfo(id).bornAt;
        vm.warp(block.timestamp + 1 hours);
        _deliver(requestId, bytes32(uint256(0xBBBB)));
        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, bytes32(uint256(0xAAAA)));
        assertEq(p.bornAt, bornAt);
        vm.warp(p.deathAt + 1);
        _deliver(requestId, bytes32(uint256(0xCCCC))); // no revival either
        assertEq(uint8(_status(id)), uint8(IArcPet.Status.Dead));
    }

    function test_callback_fitsGasLimitWithMargin() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        bytes32 genes = keccak256("worst case: every bit set somewhere");
        uint32 limit = pet.CALLBACK_GAS_LIMIT();
        vm.cool(address(pet)); // storage cold, as in a real fulfill tx
        vm.prank(address(coord));
        uint256 g = gasleft();
        pet.rawFulfillRandomness{gas: limit}(requestId, genes);
        uint256 used = g - gasleft();
        emit log_named_uint("callback gas (cold, incl. call overhead)", used);
        assertEq(pet.petInfo(id).genes, genes);
        assertLt(used, 70_000, "callback must keep >= 30% margin under CALLBACK_GAS_LIMIT");
    }

    // ================================================================ claimGenes (TestCoordinator; real BLS in ArcPetRealCoordinator)

    function test_claimGenes_afterCallbackFailure() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        vm.mockCallRevert(address(pet), abi.encodeWithSelector(IArcDrawConsumer.rawFulfillRandomness.selector), "");
        _fulfill(requestId);
        vm.clearMockedCalls();

        IArcDrawCoordinator.Request memory r = coord.getRequest(requestId);
        assertEq(uint8(r.status), uint8(IArcDrawCoordinator.Status.Fulfilled));
        assertEq(uint8(_status(id)), uint8(IArcPet.Status.Egg), "callback swallowed, egg stuck");

        vm.warp(block.timestamp + 30 days); // any time later, by anyone
        uint64 t = uint64(block.timestamp);
        uint32 th = PetLib.hungerWindow(r.randomness);
        uint32 tp = PetLib.playWindow(r.randomness);
        vm.expectEmit(address(pet));
        emit IArcPet.Hatched(id, r.randomness, t, PetLib.deathAt(t, t, th, tp), true);
        vm.prank(carol);
        pet.claimGenes(id);

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, r.randomness);
        assertEq(p.bornAt, t);
        assertEq(p.lastFed, t);
        assertEq(p.lastPlayed, t);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Alive));

        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyHatched.selector, id));
        pet.claimGenes(id);
    }

    function test_claimGenes_revertsWhilePending() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        vm.expectRevert(
            abi.encodeWithSelector(
                IArcPet.RequestNotFulfilled.selector, id, requestId, IArcDrawCoordinator.Status.Pending
            )
        );
        pet.claimGenes(id);
    }

    function test_claimGenes_revertsAfterSuccessfulCallback() public {
        uint256 id = _born(alice);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyHatched.selector, id));
        pet.claimGenes(id);
    }

    function test_claimGenes_revertsForNonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 1));
        pet.claimGenes(1);
    }

    /// @notice R8: a refunded (expired) request is still fulfillable, so the egg still hatches months later.
    function test_refundedRequest_stillHatches() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        vm.warp(coord.expiresAt(requestId) + 90 days);
        coord.refund(requestId);
        assertEq(uint8(coord.getRequest(requestId).status), uint8(IArcDrawCoordinator.Status.Refunded));
        vm.expectRevert(
            abi.encodeWithSelector(
                IArcPet.RequestNotFulfilled.selector, id, requestId, IArcDrawCoordinator.Status.Refunded
            )
        );
        pet.claimGenes(id);

        _fulfill(requestId);
        assertEq(uint8(_status(id)), uint8(IArcPet.Status.Alive));
        assertEq(pet.petInfo(id).bornAt, block.timestamp);
    }

    // ================================================================ feed / play

    function test_feed_byAnyoneResetsHunger() public {
        uint256 id = _bornWith(alice, FAST_HUNGER);
        vm.warp(block.timestamp + 10 hours);
        assertLt(pet.petInfo(id).hunger, 100);

        uint64 t = uint64(block.timestamp);
        uint64 lastPlayed = pet.petInfo(id).lastPlayed;
        uint64 expectedDeath = t + TH_MIN < lastPlayed + TP_MAX ? t + TH_MIN : lastPlayed + TP_MAX;
        vm.expectEmit(address(pet));
        emit IArcPet.Fed(id, bob, expectedDeath);
        vm.prank(bob);
        pet.feed(id);

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.lastFed, t);
        assertEq(p.hunger, 100);
        assertEq(p.deathAt, expectedDeath);
        assertEq(pet.ownerOf(id), alice, "feeding never moves the pet");
    }

    function test_play_byAnyoneResetsHappiness() public {
        uint256 id = _bornWith(alice, FAST_HUNGER);
        vm.warp(block.timestamp + 10 hours);
        assertLt(pet.petInfo(id).happiness, 100);

        uint64 t = uint64(block.timestamp);
        uint64 d = pet.deathAt(id); // still hunger-bound
        vm.expectEmit(address(pet));
        emit IArcPet.Played(id, carol, d);
        vm.prank(carol);
        pet.play(id);

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.lastPlayed, t);
        assertEq(p.happiness, 100);
    }

    function test_feed_repeatedDoesNotFarm() public {
        uint256 id = _born(alice);
        pet.feed(id);
        uint64 d = pet.deathAt(id);
        pet.feed(id);
        pet.feed(id);
        assertEq(pet.deathAt(id), d, "stat caps at 100");
    }

    function test_feed_play_revertOnEgg() public {
        (uint256 id,) = _hatch(alice, "Pixel");
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NotHatched.selector, id));
        pet.feed(id);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NotHatched.selector, id));
        pet.play(id);
    }

    function test_feed_play_revertOnNonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 0));
        pet.feed(0);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 5));
        pet.play(5);
    }

    function test_feed_oneSecondBeforeDeathWorks() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id) - 1);
        pet.feed(id);
        pet.play(id);
        assertTrue(pet.isAlive(id));
    }

    /// @notice D6: no grace window; a tx mined exactly at deathAt reverts.
    function test_feed_play_revertAtExactDeathAt() public {
        uint256 id = _born(alice);
        uint64 d = pet.deathAt(id);
        vm.warp(d);
        assertFalse(pet.isAlive(id));
        vm.expectRevert(abi.encodeWithSelector(IArcPet.PetDead.selector, id, d));
        pet.feed(id);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.PetDead.selector, id, d));
        pet.play(id);
    }

    function test_feed_revertsWhenBuried() public {
        uint256 id = _born(alice);
        uint64 d = pet.deathAt(id);
        vm.warp(d + 1 days);
        pet.bury(id);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.PetDead.selector, id, d));
        pet.feed(id);
    }

    /// @notice deathAt = min(lastFed + TH, lastPlayed + TP): a fed but bored pet still dies.
    function test_deathAt_isMinOfBothWindows() public {
        uint256 id = _bornWith(alice, FAST_HUNGER);
        uint64 b = pet.petInfo(id).bornAt;
        assertEq(pet.deathAt(id), b + TH_MIN, "hunger bound at birth");

        vm.warp(b + 60_000);
        pet.feed(id);
        assertEq(pet.deathAt(id), b + 60_000 + TH_MIN);
        vm.warp(b + 120_000);
        pet.feed(id);
        vm.warp(b + 180_000);
        pet.feed(id);
        assertEq(pet.deathAt(id), b + TP_MAX, "now play-bound");

        vm.warp(b + TP_MAX);
        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertGt(p.hunger, 0);
        assertEq(p.happiness, 0);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Dead));
        assertEq(uint8(p.mood), uint8(IArcPet.Mood.Tomb));
    }

    // ================================================================ mood

    function test_mood_hungryThenSad() public {
        uint256 id = _bornWith(alice, FAST_HUNGER);
        uint64 b = pet.petInfo(id).bornAt;

        // hunger = 100 - floor(100 * e / 69_120) < 30  <=>  e >= 49_075.2
        vm.warp(b + 49_075);
        assertEq(pet.petInfo(id).hunger, 30);
        assertEq(uint8(pet.petInfo(id).mood), uint8(IArcPet.Mood.Happy));
        vm.warp(b + 49_076);
        assertEq(pet.petInfo(id).hunger, 29);
        assertEq(uint8(pet.petInfo(id).mood), uint8(IArcPet.Mood.Hungry));

        // keep it fed; happiness < 30 <=> floor(100 * e / 207_360) >= 71 <=> e >= 147_225.6
        pet.feed(id);
        vm.warp(b + 98_000);
        pet.feed(id);
        vm.warp(b + 120_000);
        pet.feed(id);
        vm.warp(b + 147_225);
        assertEq(pet.petInfo(id).happiness, 30);
        vm.warp(b + 147_226);
        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.happiness, 29);
        assertGe(p.hunger, 30);
        assertEq(uint8(p.mood), uint8(IArcPet.Mood.Sad));

        // hungry takes priority over sad
        vm.warp(b + 120_000 + 49_076);
        p = pet.petInfo(id);
        assertLt(p.hunger, 30);
        assertLt(p.happiness, 30);
        assertEq(uint8(p.mood), uint8(IArcPet.Mood.Hungry));
    }

    function test_petInfo_ageTicksWhileAliveAndFreezesAtDeath() public {
        uint256 id = _born(alice);
        uint64 b = pet.petInfo(id).bornAt;
        vm.warp(b + 1000);
        assertEq(pet.petInfo(id).age, 1000);
        uint64 d = pet.deathAt(id);
        vm.warp(d + 50 days);
        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Dead));
        assertEq(p.age, d - b);
        assertEq(p.deathAt, d);
        assertEq(p.hunger, 0);
        assertEq(p.happiness, 0);
    }

    // ================================================================ bury

    function test_bury_permissionlessRecordsDeathAtNotNow() public {
        uint256 id = _born(alice);
        uint64 b = pet.petInfo(id).bornAt;
        uint64 d = pet.deathAt(id);
        vm.warp(d + 10 days);

        vm.expectEmit(address(pet));
        emit IArcPet.Died(id, carol, d, d - b);
        vm.prank(carol);
        pet.bury(id);

        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.diedAt, d);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Buried));
        assertEq(uint8(p.mood), uint8(IArcPet.Mood.Tomb));
        assertEq(p.age, d - b);
        vm.warp(block.timestamp + 400 days);
        assertEq(pet.petInfo(id).age, d - b, "frozen forever");
        assertEq(pet.ownerOf(id), alice);
    }

    function test_bury_atExactDeathAt() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id));
        pet.bury(id);
        assertEq(uint8(_status(id)), uint8(IArcPet.Status.Buried));
    }

    function test_bury_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 1));
        pet.bury(1);

        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NotHatched.selector, id));
        pet.bury(id);

        _fulfill(requestId);
        uint64 d = pet.deathAt(id);
        vm.warp(d - 1);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NotDead.selector, id, d));
        pet.bury(id);

        vm.warp(d);
        pet.bury(id);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.AlreadyBuried.selector, id));
        pet.bury(id);
    }

    // ================================================================ soulbound / ERC-721 / ERC-165

    function test_soulbound_everyTransferAndApprovalReverts() public {
        uint256 id = _born(alice);
        vm.startPrank(alice);
        vm.expectRevert(IArcPet.Soulbound.selector);
        pet.approve(bob, id);
        vm.expectRevert(IArcPet.Soulbound.selector);
        pet.setApprovalForAll(bob, true);
        vm.expectRevert(IArcPet.Soulbound.selector);
        pet.transferFrom(alice, bob, id);
        vm.expectRevert(IArcPet.Soulbound.selector);
        pet.safeTransferFrom(alice, bob, id);
        vm.expectRevert(IArcPet.Soulbound.selector);
        pet.safeTransferFrom(alice, bob, id, "");
        vm.stopPrank();
        assertEq(pet.ownerOf(id), alice);
        assertEq(pet.balanceOf(bob), 0);
    }

    function test_erc721_readSurface() public {
        uint256 id = _born(alice);
        assertEq(pet.name(), "ArcPet");
        assertEq(pet.symbol(), "PET");
        assertEq(pet.getApproved(id), address(0));
        assertFalse(pet.isApprovedForAll(alice, bob));
        assertTrue(pet.locked(id));
        assertEq(pet.balanceOf(bob), 0);

        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.ownerOf(9);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.getApproved(9);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.locked(9);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.tokenURI(9);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.petInfo(9);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.deathAt(9);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.NonexistentPet.selector, 9));
        pet.isAlive(9);
    }

    function test_erc165_interfaceIds() public view {
        assertEq(type(IERC165).interfaceId, bytes4(0x01ffc9a7));
        assertEq(type(IERC721).interfaceId, bytes4(0x80ac58cd));
        assertEq(type(IERC721Metadata).interfaceId, bytes4(0x5b5e139f));
        assertTrue(pet.supportsInterface(0x01ffc9a7));
        assertTrue(pet.supportsInterface(0x80ac58cd));
        assertTrue(pet.supportsInterface(0x5b5e139f));
        assertTrue(pet.supportsInterface(0xb45a3c0e)); // ERC-5192
        assertFalse(pet.supportsInterface(0xffffffff));
        assertFalse(pet.supportsInterface(0x780e9d63)); // ERC-721 Enumerable: not claimed
    }

    function test_balanceOf_countsDeadPets() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id));
        _hatch(alice, "Two");
        assertEq(pet.balanceOf(alice), 2);
        assertEq(pet.ownerOf(1), alice);
        assertEq(pet.ownerOf(2), alice);
    }

    function test_tokenURI_doesNotRevertInAnyStatus() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        _assertMetadataPrefix(pet.tokenURI(id));
        _fulfill(requestId);
        _assertMetadataPrefix(pet.tokenURI(id));
        vm.warp(pet.deathAt(id));
        _assertMetadataPrefix(pet.tokenURI(id));
        pet.bury(id);
        _assertMetadataPrefix(pet.tokenURI(id));
    }

    // ================================================================ immutability / no funds

    function test_immutableParams_noOwnerNoFunds() public {
        assertEq(address(pet.coordinator()), address(coord));
        assertEq(pet.CALLBACK_GAS_LIMIT(), 100_000);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(pet).call{value: 1}("");
        assertFalse(ok, "no receive/fallback");
        vm.prank(alice);
        (ok,) = address(pet).call{value: 1}(abi.encodeCall(IArcPet.feed, (1)));
        assertFalse(ok, "no payable entry point");
        assertEq(address(pet).balance, 0);
    }

    // ================================================================ helpers

    /// @dev PetRenderer is built in parallel; only assert the prefix once it returns something.
    function _assertMetadataPrefix(string memory uri) internal pure {
        bytes memory u = bytes(uri);
        if (u.length == 0) return;
        bytes memory prefix = "data:application/json;base64,";
        assertGe(u.length, prefix.length);
        for (uint256 i; i < prefix.length; ++i) {
            assertEq(u[i], prefix[i]);
        }
    }
}
