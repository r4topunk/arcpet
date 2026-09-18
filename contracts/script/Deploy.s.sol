// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {ArcPet} from "../src/ArcPet.sol";
import {IArcDrawCoordinator} from "../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";

/// @notice Deploys ArcPet on Arc mainnet (chain 5042) against the production ArcDraw coordinator.
///         ArcPet is immutable and ownerless (D14): a wrong constructor argument means a redeploy, so this script
///         takes the coordinator only from deployments/arc-mainnet.json, checks it against the hard-coded address,
///         checks that it has code and accepts ArcPet's callback gas limit, and reads the wiring back after deploy.
///
/// The signer is never read from this file. Use an encrypted Foundry keystore (operator only):
///   # simulation (sends nothing):
///   forge script script/Deploy.s.sol --rpc-url arc --account <keystore> --sender <deployer>
///   # real deploy + Sourcify verification:
///   forge script script/Deploy.s.sol --rpc-url arc --account <keystore> --sender <deployer> --broadcast \
///     --verify --verifier sourcify
///   # then record address / block / tx into deployments/arc-mainnet.json:
///   node script/record-deployment.mjs
///
/// Refuses to run when deployments/arc-mainnet.json already has an ArcPet address (set ARCPET_ALLOW_REDEPLOY=true to
/// override deliberately).
contract Deploy is Script {
    /// @notice ArcDraw coordinator on Arc mainnet (arc-randomness/deployments/arc-mainnet.json).
    address public constant ARCDRAW_COORDINATOR = 0x3cfDaa3521fDff2b891590c2693972Eb3e1B0324;
    uint256 public constant ARC_MAINNET = 5042;
    string public constant DEPLOYMENTS = "../deployments/arc-mainnet.json";
    /// @notice Must equal ArcPet.CALLBACK_GAS_LIMIT (checked after deploy); checked against the coordinator before
    ///         deploying, so an incompatible coordinator spends no gas.
    uint32 public constant CALLBACK_GAS_LIMIT = 100_000;

    error UnsupportedChain(uint256 chainId);
    error CoordinatorMismatch(address inJson, address expected);
    error CoordinatorHasNoCode(address coordinator);
    error CallbackGasTooHigh(uint32 needed, uint32 max);
    error AlreadyDeployed(address arcPet);
    error WiringMismatch(address coordinator);

    /// @notice Entry point of `forge script`.
    function run() external returns (ArcPet pet) {
        string memory json = vm.readFile(DEPLOYMENTS);
        address recorded = _recordedArcPet(json);
        if (recorded != address(0) && !vm.envOr("ARCPET_ALLOW_REDEPLOY", false)) revert AlreadyDeployed(recorded);
        return deploy(vm.parseJsonAddress(json, ".external.ArcDrawCoordinator.address"));
    }

    /// @notice Checks chain and coordinator, deploys ArcPet, reads the wiring back.
    function deploy(address coordinator) public returns (ArcPet pet) {
        if (block.chainid != ARC_MAINNET) revert UnsupportedChain(block.chainid);
        if (coordinator != ARCDRAW_COORDINATOR) revert CoordinatorMismatch(coordinator, ARCDRAW_COORDINATOR);
        if (coordinator.code.length == 0) revert CoordinatorHasNoCode(coordinator);
        uint32 maxGas = IArcDrawCoordinator(coordinator).MAX_CALLBACK_GAS_LIMIT();
        if (CALLBACK_GAS_LIMIT > maxGas) revert CallbackGasTooHigh(CALLBACK_GAS_LIMIT, maxGas);

        vm.startBroadcast();
        pet = new ArcPet(IArcDrawCoordinator(coordinator));
        vm.stopBroadcast();

        if (address(pet.coordinator()) != coordinator) revert WiringMismatch(address(pet.coordinator()));
        if (pet.CALLBACK_GAS_LIMIT() != CALLBACK_GAS_LIMIT) {
            revert CallbackGasTooHigh(pet.CALLBACK_GAS_LIMIT(), maxGas);
        }

        console2.log("chainId           ", block.chainid);
        console2.log("ArcDrawCoordinator", coordinator);
        console2.log("ArcPet            ", address(pet));
    }

    function _recordedArcPet(string memory json) internal pure returns (address) {
        string memory addr = vm.parseJsonString(json, ".contracts.ArcPet.address");
        return bytes(addr).length == 0 ? address(0) : vm.parseAddress(addr);
    }
}
