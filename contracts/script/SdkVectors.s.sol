// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {ArcPet} from "../src/ArcPet.sol";
import {IArcPet} from "../src/interfaces/IArcPet.sol";
import {PetLib} from "../src/libraries/PetLib.sol";
import {IArcDrawCoordinator} from "../src/vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {TestCoordinator} from "../test/vendor/arcdraw/TestCoordinator.sol";

/// @notice Writes packages/sdk/test/fixtures/parity.json: outputs of PetLib and of ArcPet.petInfo for fixed inputs, so
///         the SDK's TypeScript mirror (packages/sdk/src/pet.ts, state.ts) is tested against the real Solidity.
/// @dev Local simulation only: deploys a TestCoordinator + ArcPet in the script VM, never broadcasts, no RPC.
///      Run from contracts/: `forge script script/SdkVectors.s.sol` (or `pnpm contracts:vectors`).
///      Every number is written as a decimal string (uint256 does not fit a JSON number); bytes as 0x hex.
contract SdkVectors is Script {
    string internal constant OUT = "../packages/sdk/test/fixtures/parity.json";
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000; // untouched: bounty is 0
    uint64 internal constant START = 1_789_625_579;

    ArcPet internal pet;
    TestCoordinator internal coord;

    function run() external {
        string memory json = string.concat(
            "{\n",
            '"genes":[',
            _genesVectors(),
            "],\n",
            '"statAt":[',
            _statVectors(),
            "],\n",
            '"deathAt":[',
            _deathVectors(),
            "],\n",
            '"mood":[',
            _moodVectors(),
            "],\n",
            '"names":[',
            _nameVectors(),
            "],\n",
            '"petInfo":[',
            _petInfoVectors(),
            "]\n}\n"
        );
        vm.writeFile(OUT, json);
    }

    // ---------------------------------------------------------------- PetLib

    function _genesVectors() internal pure returns (string memory out) {
        bytes32[6] memory edge = [
            bytes32(0),
            bytes32(type(uint256).max),
            bytes32(uint256(0x7f)),
            bytes32(uint256(0xff00)),
            bytes32(uint256(0xff0000)),
            bytes32(uint256(0x80) | (uint256(1) << 24) | (uint256(1) << 255))
        ];
        for (uint256 i; i < edge.length + 58; ++i) {
            bytes32 g = i < edge.length ? edge[i] : keccak256(abi.encode("genes", i));
            out = string.concat(
                out,
                i == 0 ? "" : ",",
                "\n{",
                _kv("genes", vm.toString(g)),
                ",",
                _kv("species", vm.toString(PetLib.species(g))),
                ",",
                _kv("palette", vm.toString(PetLib.palette(g))),
                ",",
                _kv("eyes", vm.toString(PetLib.eyes(g))),
                ",",
                _kv("hungerWindow", vm.toString(PetLib.hungerWindow(g))),
                ",",
                _kv("playWindow", vm.toString(PetLib.playWindow(g))),
                "}"
            );
        }
    }

    function _statVectors() internal pure returns (string memory out) {
        for (uint256 i; i < 120; ++i) {
            uint256 r = uint256(keccak256(abi.encode("stat", i)));
            uint64 last = uint64(START + (r % 1_000_000));
            uint32 window = uint32(69_120 + ((r >> 64) % 138_241));
            uint256 nowTs;
            uint256 mode = i % 6;
            if (mode == 0) nowTs = last; // exactly at last -> 100
            else if (mode == 1) nowTs = last - (r >> 128) % 1000; // before last -> 100
            else if (mode == 2) nowTs = uint256(last) + window; // exactly at the window -> 0
            else if (mode == 3) nowTs = uint256(last) + window - 1; // one second before -> 1
            else if (mode == 4) nowTs = uint256(last) + window + (r >> 128) % 100_000; // after -> 0
            else nowTs = uint256(last) + (r >> 128) % window; // inside
            out = string.concat(
                out,
                i == 0 ? "" : ",",
                "\n{",
                _kv("last", vm.toString(last)),
                ",",
                _kv("window", vm.toString(window)),
                ",",
                _kv("now", vm.toString(nowTs)),
                ",",
                _kv("value", vm.toString(PetLib.statAt(last, window, nowTs))),
                "}"
            );
        }
    }

    function _deathVectors() internal pure returns (string memory out) {
        for (uint256 i; i < 60; ++i) {
            uint256 r = uint256(keccak256(abi.encode("death", i)));
            uint64 lastFed = uint64(START + (r % 500_000));
            uint64 lastPlayed = uint64(START + ((r >> 64) % 500_000));
            uint32 th = uint32(69_120 + ((r >> 128) % 34_561));
            uint32 tp = uint32(138_240 + ((r >> 160) % 69_121));
            out = string.concat(
                out,
                i == 0 ? "" : ",",
                "\n{",
                _kv("lastFed", vm.toString(lastFed)),
                ",",
                _kv("lastPlayed", vm.toString(lastPlayed)),
                ",",
                _kv("th", vm.toString(th)),
                ",",
                _kv("tp", vm.toString(tp)),
                ",",
                _kv("deathAt", vm.toString(PetLib.deathAt(lastFed, lastPlayed, th, tp))),
                "}"
            );
        }
    }

    function _moodVectors() internal pure returns (string memory out) {
        uint8[5] memory levels = [0, 29, 30, 31, 100];
        bool first = true;
        for (uint8 s; s < 5; ++s) {
            for (uint256 h; h < levels.length; ++h) {
                for (uint256 p; p < levels.length; ++p) {
                    IArcPet.Mood m = PetLib.moodOf(IArcPet.Status(s), levels[h], levels[p]);
                    out = string.concat(
                        out,
                        first ? "" : ",",
                        "\n{",
                        _kv("status", vm.toString(s)),
                        ",",
                        _kv("hunger", vm.toString(levels[h])),
                        ",",
                        _kv("happiness", vm.toString(levels[p])),
                        ",",
                        _kv("mood", vm.toString(uint8(m))),
                        "}"
                    );
                    first = false;
                }
            }
        }
    }

    function _nameVectors() internal pure returns (string memory out) {
        bytes[16] memory names = [
            bytes(""),
            bytes("a"),
            bytes("Rex"),
            bytes("Pixel the 2nd"),
            bytes("abcdefghijklmnopqrst"),
            bytes("abcdefghijklmnopqrstu"),
            bytes(" "),
            bytes("~tilde~"),
            bytes("<b>"),
            bytes("a&b"),
            bytes("say \"hi\""),
            bytes("back\\slash"),
            hex"c3a9", // "é" (UTF-8): outside 0x20..0x7E
            hex"61096209", // tab
            hex"7f", // DEL
            bytes("O'Neil, Jr. #1!")
        ];
        for (uint256 i; i < names.length; ++i) {
            out = string.concat(
                out,
                i == 0 ? "" : ",",
                "\n{",
                _kv("bytes", vm.toString(names[i])),
                ",",
                '"valid":',
                PetLib.isValidName(names[i]) ? "true" : "false",
                "}"
            );
        }
    }

    // ---------------------------------------------------------------- ArcPet.petInfo over a scripted life

    function _petInfoVectors() internal returns (string memory out) {
        vm.warp(START);
        coord = new TestCoordinator(ARC_USDC);
        pet = new ArcPet(IArcDrawCoordinator(address(coord)));
        address a = address(0xA11CE);
        address b = address(0xB0B);
        address c = address(0xCA201);

        (uint256 idA, uint256 reqA) = _hatch(a, "Alpha");
        (uint256 idB, uint256 reqB) = _hatch(b, "Beta");
        (uint256 idC,) = _hatch(c, "Gamma"); // stays an egg forever
        out = string.concat(_snap(idA), ",", _snap(idC));

        vm.warp(START + 30);
        _deliver(reqA, keccak256("alpha genes"));
        _deliver(reqB, bytes32(uint256(0xff00) | 0x55)); // hg = 0xff: longest hunger window; pg = 0: shortest play window
        out = string.concat(out, ",", _snap(idA), ",", _snap(idB));

        uint64[8] memory steps = [uint64(3_600), 20_000, 40_000, 60_000, 69_000, 70_000, 90_000, 400_000];
        for (uint256 i; i < steps.length; ++i) {
            vm.warp(START + 30 + steps[i]);
            if (pet.isAlive(idA) && i % 2 == 0) {
                vm.prank(b);
                pet.feed(idA);
            }
            if (pet.isAlive(idA) && i % 3 == 0) {
                vm.prank(a);
                pet.play(idA);
            }
            out = string.concat(out, ",", _snap(idA), ",", _snap(idB), ",", _snap(idC));
        }
        pet.bury(idB);
        vm.warp(block.timestamp + 12_345);
        out = string.concat(out, ",", _snap(idB), ",", _snap(idA));
    }

    function _hatch(address who, string memory n) internal returns (uint256 id, uint256 requestId) {
        vm.prank(who);
        (id, requestId) = pet.hatch(n);
    }

    function _deliver(uint256 requestId, bytes32 genes) internal {
        vm.prank(address(coord));
        pet.rawFulfillRandomness(requestId, genes);
    }

    function _snap(uint256 id) internal view returns (string memory) {
        IArcPet.PetInfo memory p = pet.petInfo(id);
        string memory raw = string.concat(
            _kv("id", vm.toString(p.id)),
            ",",
            _kv("owner", vm.toString(p.owner)),
            ",",
            _kv("name", p.name),
            ",",
            _kv("genes", vm.toString(p.genes)),
            ",",
            _kv("requestId", vm.toString(p.requestId)),
            ","
        );
        raw = string.concat(
            raw,
            _kv("laidAt", vm.toString(p.laidAt)),
            ",",
            _kv("bornAt", vm.toString(p.bornAt)),
            ",",
            _kv("lastFed", vm.toString(p.lastFed)),
            ",",
            _kv("lastPlayed", vm.toString(p.lastPlayed)),
            ","
        );
        raw = string.concat(
            raw,
            _kv("diedAt", vm.toString(p.diedAt)),
            ",",
            _kv("hungerWindow", vm.toString(p.hungerWindow)),
            ",",
            _kv("playWindow", vm.toString(p.playWindow)),
            ","
        );
        string memory derived = string.concat(
            _kv("asOf", vm.toString(p.asOf)),
            ",",
            _kv("status", vm.toString(uint8(p.status))),
            ",",
            _kv("mood", vm.toString(uint8(p.mood))),
            ",",
            _kv("deathAt", vm.toString(p.deathAt)),
            ","
        );
        derived = string.concat(
            derived,
            _kv("age", vm.toString(p.age)),
            ",",
            _kv("hunger", vm.toString(p.hunger)),
            ",",
            _kv("happiness", vm.toString(p.happiness)),
            ",",
            _kv("species", vm.toString(p.species)),
            ",",
            _kv("palette", vm.toString(p.palette)),
            ",",
            _kv("eyes", vm.toString(p.eyes)),
            ",",
            _kv("isAlive", pet.isAlive(id) ? "true" : "false")
        );
        return string.concat("\n{", raw, derived, "}");
    }

    /// @dev Values are JSON strings. Only used with ASCII names from this file (no `"` or `\`), so no escaping.
    function _kv(string memory k, string memory v) internal pure returns (string memory) {
        return string.concat('"', k, '":"', v, '"');
    }
}
