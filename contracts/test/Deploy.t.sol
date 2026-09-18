// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {ArcPet} from "../src/ArcPet.sol";
import {ArcDrawCoordinator} from "./vendor/arcdraw/ArcDrawCoordinator.sol";

/// @notice The deploy script wires ArcPet to the hard-coded ArcDraw coordinator and refuses anything else.
///         Local only: the coordinator's runtime code is etched at its mainnet address; nothing is broadcast.
contract DeployTest is Test {
    address internal constant COORD = 0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    Deploy internal script;

    function setUp() public {
        script = new Deploy();
        vm.chainId(5042);
        vm.etch(COORD, address(new ArcDrawCoordinator(ARC_USDC)).code);
    }

    function test_deploy_jsonCoordinatorMatchesConstant() public view {
        string memory json = vm.readFile("../deployments/arc-mainnet.json");
        assertEq(vm.parseJsonAddress(json, ".external.ArcDrawCoordinator.address"), script.ARCDRAW_COORDINATOR());
        assertEq(vm.parseJsonUint(json, ".chainId"), 5042);
    }

    function test_deploy_run_wiresCoordinator() public {
        // keeps passing after the real deploy is recorded in the JSON (run() refuses a redeploy by default)
        vm.setEnv("ARCPET_ALLOW_REDEPLOY", "true");
        ArcPet pet = script.run();
        assertEq(address(pet.coordinator()), COORD);
        assertEq(pet.CALLBACK_GAS_LIMIT(), script.CALLBACK_GAS_LIMIT());
        assertEq(pet.totalSupply(), 0);
    }

    function test_deploy_revertsOnWrongChain() public {
        vm.chainId(5042002);
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 5042002));
        script.deploy(COORD);
    }

    function test_deploy_revertsOnOtherCoordinator() public {
        address other = makeAddr("other");
        vm.expectRevert(abi.encodeWithSelector(Deploy.CoordinatorMismatch.selector, other, COORD));
        script.deploy(other);
    }

    function test_deploy_revertsWhenCoordinatorHasNoCode() public {
        vm.etch(COORD, "");
        vm.expectRevert(abi.encodeWithSelector(Deploy.CoordinatorHasNoCode.selector, COORD));
        script.deploy(COORD);
    }
}
