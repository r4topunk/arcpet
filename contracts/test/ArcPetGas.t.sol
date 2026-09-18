// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ArcPetBase} from "./utils/ArcPetBase.sol";
import {IArcDrawConsumer} from "../src/vendor/arcdraw/interfaces/IArcDrawConsumer.sol";

/// @notice One measured action per test, storage cooled first so numbers match a fresh mainnet tx (execution gas,
///         excluding the 21k intrinsic cost and calldata). Written to snapshots/ArcPetGas.json by `forge test`;
///         the whole-test totals also land in .gas-snapshot via `pnpm contracts:snapshot`.
contract ArcPetGasTest is ArcPetBase {
    string internal constant GROUP = "ArcPetGas";

    function _cool() internal {
        vm.cool(address(pet));
        vm.cool(address(coord));
    }

    function test_gas_hatch() public {
        _cool();
        vm.prank(alice);
        vm.startSnapshotGas(GROUP, "hatch");
        pet.hatch("Pixel the Second");
        uint256 used = vm.stopSnapshotGas(GROUP, "hatch");
        assertLt(used, 250_000);
    }

    /// @notice Steady state for a new wallet: supply and coordinator counters already non-zero.
    function test_gas_hatchNotFirst() public {
        _hatch(bob, "Earlier");
        _cool();
        vm.prank(alice);
        vm.startSnapshotGas(GROUP, "hatchNotFirst");
        pet.hatch("Pixel the Second");
        uint256 used = vm.stopSnapshotGas(GROUP, "hatchNotFirst");
        assertLt(used, 230_000);
    }

    function test_gas_hatchWithAutoBury() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id));
        _cool();
        vm.prank(alice);
        vm.startSnapshotGas(GROUP, "hatchWithAutoBury");
        pet.hatch("Again");
        uint256 used = vm.stopSnapshotGas(GROUP, "hatchWithAutoBury");
        assertLt(used, 250_000);
    }

    /// @notice The callback alone, as the coordinator's gas-limited CALL runs it (limit 100_000).
    function test_gas_callback() public {
        (, uint256 requestId) = _hatch(alice, "Pixel");
        bytes32 genes = keccak256("genes");
        uint32 limit = pet.CALLBACK_GAS_LIMIT();
        _cool();
        vm.prank(address(coord));
        vm.startSnapshotGas(GROUP, "callback");
        pet.rawFulfillRandomness{gas: limit}(requestId, genes);
        uint256 used = vm.stopSnapshotGas(GROUP, "callback");
        assertEq(pet.petInfo(1).genes, genes);
        assertLt(used, 70_000, ">= 30% margin under CALLBACK_GAS_LIMIT");
    }

    /// @notice Coordinator fulfill (fake BLS in TestCoordinator, so this is fulfill minus the pairing) + callback.
    function test_gas_fulfillWithCallback() public {
        (, uint256 requestId) = _hatch(alice, "Pixel");
        vm.warp(coord.roundTimestamp(coord.getRequest(requestId).round));
        _cool();
        vm.startSnapshotGas(GROUP, "fulfillWithCallback_noBls");
        _fulfill(requestId);
        vm.stopSnapshotGas(GROUP, "fulfillWithCallback_noBls");
        assertTrue(pet.isAlive(1));
    }

    function test_gas_claimGenes() public {
        (uint256 id, uint256 requestId) = _hatch(alice, "Pixel");
        vm.mockCallRevert(address(pet), abi.encodeWithSelector(IArcDrawConsumer.rawFulfillRandomness.selector), "");
        _fulfill(requestId);
        vm.clearMockedCalls();
        _cool();
        vm.startSnapshotGas(GROUP, "claimGenes");
        pet.claimGenes(id);
        uint256 used = vm.stopSnapshotGas(GROUP, "claimGenes");
        assertLt(used, 100_000);
    }

    function test_gas_feed() public {
        uint256 id = _born(alice);
        vm.warp(block.timestamp + 12 hours);
        _cool();
        vm.prank(bob);
        vm.startSnapshotGas(GROUP, "feed");
        pet.feed(id);
        uint256 used = vm.stopSnapshotGas(GROUP, "feed");
        assertLt(used, 50_000);
    }

    function test_gas_play() public {
        uint256 id = _born(alice);
        vm.warp(block.timestamp + 12 hours);
        _cool();
        vm.prank(bob);
        vm.startSnapshotGas(GROUP, "play");
        pet.play(id);
        uint256 used = vm.stopSnapshotGas(GROUP, "play");
        assertLt(used, 50_000);
    }

    function test_gas_bury() public {
        uint256 id = _born(alice);
        vm.warp(pet.deathAt(id) + 1 days);
        _cool();
        vm.prank(carol);
        vm.startSnapshotGas(GROUP, "bury");
        pet.bury(id);
        uint256 used = vm.stopSnapshotGas(GROUP, "bury");
        assertLt(used, 60_000);
    }

    function test_gas_petInfo() public {
        uint256 id = _born(alice);
        _cool();
        vm.startSnapshotGas(GROUP, "petInfo");
        pet.petInfo(id);
        vm.stopSnapshotGas(GROUP, "petInfo");
    }

    /// @notice View cost; explorers call it through eth_call (renderer-dependent).
    function test_gas_tokenURI() public {
        uint256 id = _born(alice);
        _cool();
        vm.startSnapshotGas(GROUP, "tokenURI");
        pet.tokenURI(id);
        uint256 used = vm.stopSnapshotGas(GROUP, "tokenURI");
        assertLt(used, 30_000_000);
    }
}
