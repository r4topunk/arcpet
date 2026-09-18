// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ArcPet} from "../../src/ArcPet.sol";
import {IArcPet} from "../../src/interfaces/IArcPet.sol";
import {IArcDrawConsumer} from "../../src/vendor/arcdraw/interfaces/IArcDrawConsumer.sol";
import {IArcDrawCoordinator} from "../../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {TestCoordinator, fakeSignature} from "../vendor/arcdraw/TestCoordinator.sol";

/// @notice Drives ArcPet through hatch / fulfill (callback ok or failing) / claimGenes / feed / play / bury / time,
///         and records ghost state the invariants compare against. Never asserts itself (a revert here is ignored by
///         the invariant runner); violations are latched in `violation` instead.
contract ArcPetHandler is Test {
    ArcPet public immutable pet;
    TestCoordinator public immutable coord;

    address[4] internal actors;
    uint256[] internal requestIds;

    uint256 public mints;
    string public violation; // empty = none
    mapping(uint256 id => address) public mintOwner;
    mapping(uint256 id => bytes32) public firstGenes;
    mapping(uint256 id => uint64) public deadDeathAt; // deathAt when first observed Dead/Buried (0 = never)

    uint256 public callsFeed;
    uint256 public callsBury;
    uint256 public callsClaim;
    uint256 public callsFulfill;

    constructor(ArcPet pet_, TestCoordinator coord_) {
        pet = pet_;
        coord = coord_;
        actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2"), makeAddr("a3")];
    }

    function actorCount() external pure returns (uint256) {
        return 4;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    // ---------------------------------------------------------------- actions

    function hatch(uint256 actorSeed) external {
        address who = actors[actorSeed % 4];
        uint256 current = pet.petOf(who);
        bool blocked;
        if (current != 0) {
            IArcPet.Status s = pet.petInfo(current).status;
            blocked = s == IArcPet.Status.Egg || s == IArcPet.Status.Alive;
        }
        vm.prank(who);
        try pet.hatch("Pet") returns (uint256 id, uint256 requestId) {
            if (blocked) _flag("hatch succeeded while wallet had an egg or living pet");
            ++mints;
            mintOwner[id] = who;
            requestIds.push(requestId);
            if (current != 0 && pet.petInfo(current).status != IArcPet.Status.Buried) {
                _flag("previous pet not buried by hatch");
            }
        } catch {
            if (!blocked) _flag("hatch reverted for a wallet without a living pet");
        }
        _sync();
    }

    function fulfill(uint256 reqSeed, bool breakCallback) external {
        if (requestIds.length == 0) return;
        uint256 requestId = requestIds[reqSeed % requestIds.length];
        IArcDrawCoordinator.Request memory r = coord.getRequest(requestId);
        if (r.status == IArcDrawCoordinator.Status.Fulfilled) return;
        uint64 ts = coord.roundTimestamp(r.round);
        if (block.timestamp < ts) vm.warp(ts);

        if (breakCallback) {
            vm.mockCallRevert(address(pet), abi.encodeWithSelector(IArcDrawConsumer.rawFulfillRandomness.selector), "");
        }
        coord.fulfill(requestId, fakeSignature(r.round));
        if (breakCallback) vm.clearMockedCalls();
        ++callsFulfill;

        uint256 id = pet.petByRequest(requestId);
        bool hatched = pet.petInfo(id).bornAt != 0;
        if (!breakCallback && !hatched) _flag("callback did not hatch the egg");
        if (breakCallback && hatched) _flag("egg hatched although the callback reverted");
        _sync();
    }

    function claimGenes(uint256 idSeed, uint256 callerSeed) external {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        bytes32 before = pet.petInfo(id).genes;
        vm.prank(actors[callerSeed % 4]);
        try pet.claimGenes(id) {
            ++callsClaim;
            if (before != bytes32(0)) _flag("claimGenes overwrote genes");
            if (pet.petInfo(id).genes != coord.getRequest(pet.petInfo(id).requestId).randomness) {
                _flag("claimGenes genes != coordinator randomness");
            }
        } catch {}
        _sync();
    }

    function feed(uint256 idSeed, uint256 callerSeed, bool playInstead) external {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        bool aliveBefore = pet.petInfo(id).status == IArcPet.Status.Alive;
        uint64 deathBefore = pet.petInfo(id).deathAt;
        bool ok;
        vm.prank(actors[callerSeed % 4]);
        if (playInstead) {
            try pet.play(id) {
                ok = true;
            } catch {}
        } else {
            try pet.feed(id) {
                ok = true;
            } catch {}
        }
        if (ok) {
            ++callsFeed;
            if (!aliveBefore) _flag("feed/play succeeded on a non-living pet");
            if (pet.petInfo(id).deathAt < deathBefore) _flag("care lowered deathAt");
        } else if (aliveBefore) {
            _flag("feed/play reverted on a living pet");
        }
        _sync();
    }

    function bury(uint256 idSeed, uint256 callerSeed) external {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        IArcPet.PetInfo memory b = pet.petInfo(id);
        vm.prank(actors[callerSeed % 4]);
        try pet.bury(id) {
            ++callsBury;
            if (b.status != IArcPet.Status.Dead) _flag("bury succeeded on a pet that was not Dead");
            if (pet.petInfo(id).diedAt != b.deathAt) _flag("diedAt != deathAt");
        } catch {
            if (b.status == IArcPet.Status.Dead) _flag("bury reverted on a Dead pet");
        }
        _sync();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 3 days));
        _sync();
    }

    // ---------------------------------------------------------------- ghost

    function _sync() internal {
        uint256 n = pet.totalSupply();
        for (uint256 id = 1; id <= n; ++id) {
            IArcPet.PetInfo memory p = pet.petInfo(id);
            if (firstGenes[id] == bytes32(0) && p.genes != bytes32(0)) firstGenes[id] = p.genes;
            if (deadDeathAt[id] == 0 && (p.status == IArcPet.Status.Dead || p.status == IArcPet.Status.Buried)) {
                deadDeathAt[id] = p.deathAt;
            }
        }
    }

    function _pick(uint256 seed) internal view returns (uint256) {
        uint256 n = pet.totalSupply();
        return n == 0 ? 0 : 1 + (seed % n);
    }

    function _flag(string memory why) internal {
        if (bytes(violation).length == 0) violation = why;
    }
}

/// @notice SPEC §9 invariants 1-8.
contract ArcPetInvariantTest is Test {
    ArcPet internal pet;
    TestCoordinator internal coord;
    ArcPetHandler internal handler;

    function setUp() public {
        vm.warp(1_789_625_579);
        coord = new TestCoordinator(0x3600000000000000000000000000000000000000);
        pet = new ArcPet(IArcDrawCoordinator(address(coord)));
        handler = new ArcPetHandler(pet, coord);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = ArcPetHandler.hatch.selector;
        selectors[1] = ArcPetHandler.fulfill.selector;
        selectors[2] = ArcPetHandler.claimGenes.selector;
        selectors[3] = ArcPetHandler.feed.selector;
        selectors[4] = ArcPetHandler.bury.selector;
        selectors[5] = ArcPetHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_handlerSawNoViolation() public view {
        assertEq(handler.violation(), "");
    }

    /// @notice §9.1: a pet seen Dead/Buried stays Dead/Buried with the same deathAt.
    function invariant_deadNeverRevives() public view {
        uint256 n = pet.totalSupply();
        for (uint256 id = 1; id <= n; ++id) {
            uint64 d = handler.deadDeathAt(id);
            if (d == 0) continue;
            IArcPet.PetInfo memory p = pet.petInfo(id);
            assertFalse(pet.isAlive(id));
            assertTrue(p.status == IArcPet.Status.Dead || p.status == IArcPet.Status.Buried);
            assertEq(p.deathAt, d);
            assertEq(p.age, d - p.bornAt);
        }
    }

    /// @notice §9.2: at most one Egg-or-Alive pet per wallet.
    function invariant_atMostOneLivingPetPerWallet() public view {
        uint256 n = pet.totalSupply();
        for (uint256 a; a < handler.actorCount(); ++a) {
            address who = handler.actorAt(a);
            uint256 living;
            for (uint256 id = 1; id <= n; ++id) {
                if (pet.ownerOf(id) != who) continue;
                IArcPet.Status s = pet.petInfo(id).status;
                if (s == IArcPet.Status.Egg || s == IArcPet.Status.Alive) ++living;
            }
            assertLe(living, 1);
        }
    }

    /// @notice §9.3: genes written at most once (callback or claimGenes, never overwritten).
    function invariant_genesNeverOverwritten() public view {
        uint256 n = pet.totalSupply();
        for (uint256 id = 1; id <= n; ++id) {
            IArcPet.PetInfo memory p = pet.petInfo(id);
            assertEq(p.genes, handler.firstGenes(id));
            if (p.bornAt != 0) {
                assertEq(p.genes, coord.getRequest(p.requestId).randomness, "genes == ArcDraw randomness");
            }
        }
    }

    /// @notice §9.4: diedAt written once, equals deathAt, never before birth.
    function invariant_diedAtConsistent() public view {
        uint256 n = pet.totalSupply();
        for (uint256 id = 1; id <= n; ++id) {
            IArcPet.PetInfo memory p = pet.petInfo(id);
            if (p.diedAt == 0) continue;
            assertEq(p.diedAt, p.deathAt);
            assertEq(p.diedAt, handler.deadDeathAt(id));
            assertGt(p.bornAt, 0);
            assertGe(p.diedAt, p.bornAt);
            assertEq(uint8(p.status), uint8(IArcPet.Status.Buried));
        }
    }

    /// @notice §9.5 / §9.6: owners never change, balances count every mint, ids are 1..totalSupply.
    function invariant_supplyAndOwnership() public view {
        uint256 n = pet.totalSupply();
        assertEq(n, handler.mints());
        uint256 sum;
        for (uint256 a; a < handler.actorCount(); ++a) {
            sum += pet.balanceOf(handler.actorAt(a));
        }
        assertEq(sum, n);
        for (uint256 id = 1; id <= n; ++id) {
            assertEq(pet.ownerOf(id), handler.mintOwner(id));
            assertEq(pet.petByRequest(pet.petInfo(id).requestId), id);
        }
    }

    /// @notice §9.7: never holds value.
    function invariant_holdsNoFunds() public view {
        assertEq(address(pet).balance, 0);
    }

    function afterInvariant() external view {
        // Coverage sanity: the run actually exercised the interesting paths.
        assertGt(handler.mints(), 0);
    }
}
