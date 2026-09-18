// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArcPet} from "../interfaces/IArcPet.sol";

/// @title PetLib
/// @notice The single implementation of ArcPet's gene layout (D10), decay math (D4/D5/D6, R3/R4), mood (D11) and
///         name rules (R7). Shared by ArcPet and PetRenderer so both read genes the same way. See docs/SPEC.md §3-§5.
///
/// Gene layout: g = uint256(genes), genes = the per-request ArcDraw randomness, used as is:
///   genes = keccak256(abi.encode(sha256(drandSignature), block.chainid, coordinator, requestId))
/// (derived by the coordinator, so eggs pinned to the same drand round still get different genes).
///
///   bits      width  field           decode                                   range
///   [0..1]    2      species         g & 0x3                                  0..3
///   [2..4]    3      palette         (g >> 2) & 0x7                           0..7
///   [5..6]    2      eyes            (g >> 5) & 0x3                           0..3
///   [7]       1      reserved        -                                        -
///   [8..15]   8      hungerGene hg   (g >> 8) & 0xff                          0..255
///   [16..23]  8      playGene pg     (g >> 16) & 0xff                         0..255
///   [24..255] 232    reserved (v2: cosmetics, events). Must not be read by v1 code.
///
///   multiplierBps(x) = 8000 + (x * 4000) / 255                               8000..12000 (floor division)
///   TH = BASE_TH * multiplierBps(hg) / 10000, BASE_TH = 86400 (24h)          69_120..103_680 s
///   TP = BASE_TP * multiplierBps(pg) / 10000, BASE_TP = 172800 (48h)         138_240..207_360 s
library PetLib {
    uint32 internal constant BASE_HUNGER_WINDOW = 24 hours; // TH base (R4)
    uint32 internal constant BASE_PLAY_WINDOW = 48 hours; // TP base (R4)
    uint256 internal constant MIN_MULTIPLIER_BPS = 8000; // -20%
    uint256 internal constant MULTIPLIER_SPAN_BPS = 4000; // up to +20%
    uint256 internal constant BPS = 10_000;

    uint8 internal constant SPECIES_COUNT = 4;
    uint8 internal constant PALETTE_COUNT = 8;
    uint8 internal constant EYES_COUNT = 4;

    uint8 internal constant STAT_MAX = 100;
    uint8 internal constant LOW_STAT_THRESHOLD = 30; // D11: "hungry" / "sad" below this

    uint256 internal constant MAX_NAME_LENGTH = 20; // bytes (R7)

    // ---------------------------------------------------------------- genes

    function species(bytes32 genes) internal pure returns (uint8) {
        return uint8(uint256(genes) & 0x3);
    }

    function palette(bytes32 genes) internal pure returns (uint8) {
        return uint8((uint256(genes) >> 2) & 0x7);
    }

    function eyes(bytes32 genes) internal pure returns (uint8) {
        return uint8((uint256(genes) >> 5) & 0x3);
    }

    function multiplierBps(uint8 gene) internal pure returns (uint256) {
        return MIN_MULTIPLIER_BPS + (uint256(gene) * MULTIPLIER_SPAN_BPS) / 255;
    }

    /// @notice TH in seconds (hunger 100 -> 0).
    function hungerWindow(bytes32 genes) internal pure returns (uint32) {
        uint8 hg = uint8(uint256(genes) >> 8);
        // casting to 'uint32' is safe because the result is at most 86400 * 12000 / 10000
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32((uint256(BASE_HUNGER_WINDOW) * multiplierBps(hg)) / BPS);
    }

    /// @notice TP in seconds (happiness 100 -> 0).
    function playWindow(bytes32 genes) internal pure returns (uint32) {
        uint8 pg = uint8(uint256(genes) >> 16);
        // casting to 'uint32' is safe because the result is at most 172800 * 12000 / 10000
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32((uint256(BASE_PLAY_WINDOW) * multiplierBps(pg)) / BPS);
    }

    // ---------------------------------------------------------------- decay

    /// @notice Linear decay from 100 (D4): 100 - floor(100 * elapsed / window), 0 once elapsed >= window.
    /// @dev stat > 0  <=>  nowTs < last + window, so "both stats > 0" is exactly isAlive.
    function statAt(uint64 last, uint32 window, uint256 nowTs) internal pure returns (uint8) {
        if (nowTs <= last) return STAT_MAX;
        uint256 elapsed = nowTs - last;
        if (elapsed >= window) return 0;
        // casting to 'uint8' is safe because elapsed < window keeps the result in 1..100
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint8(STAT_MAX - (uint256(STAT_MAX) * elapsed) / window);
    }

    /// @notice D6/R3: min(lastFed + TH, lastPlayed + TP).
    function deathAt(uint64 lastFed, uint64 lastPlayed, uint32 th, uint32 tp) internal pure returns (uint64) {
        uint64 a = lastFed + th;
        uint64 b = lastPlayed + tp;
        return a < b ? a : b;
    }

    /// @notice D11 sprite selector. Hungry takes priority over Sad.
    function moodOf(IArcPet.Status status, uint8 hunger, uint8 happiness) internal pure returns (IArcPet.Mood) {
        if (status == IArcPet.Status.Egg || status == IArcPet.Status.None) return IArcPet.Mood.Egg;
        if (status != IArcPet.Status.Alive) return IArcPet.Mood.Tomb;
        if (hunger < LOW_STAT_THRESHOLD) return IArcPet.Mood.Hungry;
        if (happiness < LOW_STAT_THRESHOLD) return IArcPet.Mood.Sad;
        return IArcPet.Mood.Happy;
    }

    // ---------------------------------------------------------------- names

    /// @notice R7 + SPEC §5: 1..20 bytes, each in 0x20..0x7E except `"` `&` `<` `>` `\`.
    /// @dev The restricted set means the renderer can embed names in JSON and SVG without escaping.
    function isValidName(bytes memory n) internal pure returns (bool) {
        uint256 len = n.length;
        if (len == 0 || len > MAX_NAME_LENGTH) return false;
        for (uint256 i; i < len; ++i) {
            bytes1 c = n[i];
            if (c < 0x20 || c > 0x7e) return false;
            if (c == 0x22 || c == 0x26 || c == 0x3c || c == 0x3e || c == 0x5c) return false;
        }
        return true;
    }
}
