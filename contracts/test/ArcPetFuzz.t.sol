// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ArcPetBase} from "./utils/ArcPetBase.sol";
import {IArcPet} from "../src/interfaces/IArcPet.sol";
import {PetLib} from "../src/libraries/PetLib.sol";

/// @notice Fuzz: decay (SPEC §3), deathAt, genes -> TH/TP (§4), names (§5), and the contract agreeing with PetLib.
contract ArcPetFuzzTest is ArcPetBase {
    // ================================================================ PetLib: decay

    function testFuzz_statAt_boundsAndEdges(uint64 last, uint32 window, uint64 t) public pure {
        window = uint32(bound(window, 1, type(uint32).max));
        uint8 s = PetLib.statAt(last, window, t);
        assertLe(s, 100);
        if (t <= last) {
            assertEq(s, 100);
        } else if (uint256(t) - last >= window) {
            assertEq(s, 0);
        } else {
            assertGt(s, 0, "positive strictly before last + window");
            assertEq(s, 100 - (100 * (uint256(t) - last)) / window);
        }
    }

    function testFuzz_statAt_monotoneNonIncreasing(uint64 last, uint32 window, uint64 t, uint64 dt) public pure {
        window = uint32(bound(window, 1, type(uint32).max));
        t = uint64(bound(t, 0, type(uint64).max - 1));
        dt = uint64(bound(dt, 0, type(uint64).max - t));
        assertGe(PetLib.statAt(last, window, t), PetLib.statAt(last, window, t + dt));
    }

    function testFuzz_deathAt_isMinAndMatchesStats(uint32 lastFed, uint32 lastPlayed, uint32 th, uint32 tp, uint32 dt)
        public
        pure
    {
        th = uint32(bound(th, 1, type(uint32).max));
        tp = uint32(bound(tp, 1, type(uint32).max));
        uint64 d = PetLib.deathAt(lastFed, lastPlayed, th, tp);
        uint64 a = uint64(lastFed) + th;
        uint64 b = uint64(lastPlayed) + tp;
        assertEq(d, a < b ? a : b);

        // Both stats > 0 exactly when now < deathAt (for now at or after both actions).
        uint64 last = lastFed > lastPlayed ? lastFed : lastPlayed;
        uint64 t = last + dt;
        bool bothPositive = PetLib.statAt(lastFed, th, t) > 0 && PetLib.statAt(lastPlayed, tp, t) > 0;
        assertEq(bothPositive, t < d);
    }

    // ================================================================ PetLib: genes

    function testFuzz_genes_decodeRangesAndFormula(bytes32 genes) public pure {
        uint256 g = uint256(genes);
        assertEq(PetLib.species(genes), g & 3);
        assertEq(PetLib.palette(genes), (g >> 2) & 7);
        assertEq(PetLib.eyes(genes), (g >> 5) & 3);
        assertLt(PetLib.species(genes), 4);
        assertLt(PetLib.palette(genes), 8);
        assertLt(PetLib.eyes(genes), 4);

        uint256 hg = (g >> 8) & 0xff;
        uint256 pg = (g >> 16) & 0xff;
        uint32 th = PetLib.hungerWindow(genes);
        uint32 tp = PetLib.playWindow(genes);
        assertEq(th, (86_400 * (8000 + (hg * 4000) / 255)) / 10_000);
        assertEq(tp, (172_800 * (8000 + (pg * 4000) / 255)) / 10_000);
        assertGe(th, 69_120);
        assertLe(th, 103_680);
        assertGe(tp, 138_240);
        assertLe(tp, 207_360);
    }

    function testFuzz_genes_reservedBitsIgnored(bytes32 genes, uint256 noise) public pure {
        // bit 7 and bits 24..255 are reserved: v1 must not read them.
        uint256 mask = (uint256(1) << 7) | (type(uint256).max << 24);
        bytes32 other = bytes32((uint256(genes) & ~mask) | (noise & mask));
        assertEq(PetLib.species(genes), PetLib.species(other));
        assertEq(PetLib.palette(genes), PetLib.palette(other));
        assertEq(PetLib.eyes(genes), PetLib.eyes(other));
        assertEq(PetLib.hungerWindow(genes), PetLib.hungerWindow(other));
        assertEq(PetLib.playWindow(genes), PetLib.playWindow(other));
    }

    function test_genes_windowEndpoints() public pure {
        assertEq(PetLib.hungerWindow(_genes(0, 0, 0)), 69_120); // 24h - 20%
        assertEq(PetLib.hungerWindow(_genes(255, 0, 0)), 103_680); // 24h + 20%
        assertEq(PetLib.playWindow(_genes(0, 0, 0)), 138_240); // 48h - 20%
        assertEq(PetLib.playWindow(_genes(0, 255, 0)), 207_360); // 48h + 20%
        assertEq(PetLib.multiplierBps(0), 8000);
        assertEq(PetLib.multiplierBps(255), 12_000);
    }

    function testFuzz_multiplierMonotone(uint8 a, uint8 b) public pure {
        if (a <= b) assertLe(PetLib.multiplierBps(a), PetLib.multiplierBps(b));
        else assertGt(PetLib.multiplierBps(a), PetLib.multiplierBps(b));
    }

    // ================================================================ names

    function testFuzz_isValidName_matchesReference(bytes memory n) public pure {
        assertEq(PetLib.isValidName(n), _refValidName(n));
    }

    function testFuzz_hatch_acceptsExactlyValidNames(bytes memory n) public {
        vm.assume(n.length <= 40);
        vm.prank(alice);
        if (_refValidName(n)) {
            (uint256 id,) = pet.hatch(string(n));
            assertEq(keccak256(bytes(pet.petInfo(id).name)), keccak256(n));
        } else {
            vm.expectRevert(IArcPet.InvalidName.selector);
            pet.hatch(string(n));
        }
    }

    // ================================================================ contract agrees with PetLib

    function testFuzz_birth_windowsFromGenes(bytes32 genes) public {
        uint256 id = _bornWith(alice, genes);
        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.genes, genes);
        assertEq(p.hungerWindow, PetLib.hungerWindow(genes));
        assertEq(p.playWindow, PetLib.playWindow(genes));
        assertEq(p.species, PetLib.species(genes));
        assertEq(p.palette, PetLib.palette(genes));
        assertEq(p.eyes, PetLib.eyes(genes));
        assertEq(p.deathAt, block.timestamp + p.hungerWindow, "TH <= 103_680 < 138_240 <= TP: hunger binds at birth");
    }

    function testFuzz_isAlive_iffBothStatsPositive(bytes32 genes, uint32 dt) public {
        uint256 id = _bornWith(alice, genes);
        vm.warp(block.timestamp + dt);
        IArcPet.PetInfo memory p = pet.petInfo(id);
        bool alive = pet.isAlive(id);
        assertEq(alive, p.hunger > 0 && p.happiness > 0);
        assertEq(alive, block.timestamp < p.deathAt);
        assertEq(uint8(p.status), uint8(alive ? IArcPet.Status.Alive : IArcPet.Status.Dead));
        assertEq(p.hunger, PetLib.statAt(p.lastFed, p.hungerWindow, block.timestamp));
        assertEq(p.happiness, PetLib.statAt(p.lastPlayed, p.playWindow, block.timestamp));
        assertEq(uint8(p.mood), uint8(PetLib.moodOf(p.status, p.hunger, p.happiness)));
        assertEq(p.age, (alive ? block.timestamp : p.deathAt) - p.bornAt);
    }

    /// @notice Care by anyone at any cadence shorter than TH keeps the pet alive; deathAt only moves forward.
    function testFuzz_care_keepsAliveAndDeathAtNeverDecreases(bytes32 genes, uint256 seed, address caller) public {
        uint256 id = _bornWith(alice, genes);
        uint32 th = PetLib.hungerWindow(genes);
        uint64 prev = pet.deathAt(id);
        for (uint256 i; i < 12; ++i) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            vm.warp(block.timestamp + bound(seed, 1, th - 1));
            vm.startPrank(caller);
            pet.feed(id);
            pet.play(id);
            vm.stopPrank();
            uint64 d = pet.deathAt(id);
            assertGe(d, prev, "deathAt only grows");
            prev = d;
            assertTrue(pet.isAlive(id));
        }
    }

    /// @notice D1/D6: once deathAt passes, nothing brings the pet back and deathAt / age are frozen.
    function testFuzz_death_isFinal(bytes32 genes, uint32 after_, address caller) public {
        uint256 id = _bornWith(alice, genes);
        uint64 d = pet.deathAt(id);
        uint64 b = pet.petInfo(id).bornAt;
        vm.warp(uint256(d) + after_);

        vm.startPrank(caller);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.PetDead.selector, id, d));
        pet.feed(id);
        vm.expectRevert(abi.encodeWithSelector(IArcPet.PetDead.selector, id, d));
        pet.play(id);
        vm.stopPrank();
        _deliver(pet.petInfo(id).requestId, ~genes); // late callback cannot revive or re-roll

        assertFalse(pet.isAlive(id));
        assertEq(pet.deathAt(id), d);
        assertEq(pet.petInfo(id).genes, genes);

        vm.prank(caller);
        pet.bury(id);
        IArcPet.PetInfo memory p = pet.petInfo(id);
        assertEq(p.diedAt, d);
        assertEq(p.age, d - b);
        assertEq(uint8(p.status), uint8(IArcPet.Status.Buried));
    }

    /// @notice SPEC §9.8: the callback never reverts, whatever the coordinator delivers.
    function testFuzz_callback_neverReverts(uint256 requestId, bytes32 randomness, bool hatchFirst) public {
        if (hatchFirst) _hatch(alice, "Pixel");
        vm.prank(address(coord));
        (bool ok,) = address(pet).call{gas: 100_000}(abi.encodeCall(pet.rawFulfillRandomness, (requestId, randomness)));
        assertTrue(ok);
        vm.prank(address(coord));
        (ok,) = address(pet).call{gas: 100_000}(abi.encodeCall(pet.rawFulfillRandomness, (requestId, randomness)));
        assertTrue(ok, "repeat delivery is a no-op");
    }

    // ================================================================ helpers

    function _refValidName(bytes memory n) internal pure returns (bool) {
        if (n.length == 0 || n.length > 20) return false;
        for (uint256 i; i < n.length; ++i) {
            uint8 c = uint8(n[i]);
            if (c < 32 || c > 126) return false;
            if (c == 34 || c == 38 || c == 60 || c == 62 || c == 92) return false;
        }
        return true;
    }
}
