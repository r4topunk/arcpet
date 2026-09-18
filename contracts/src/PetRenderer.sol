// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArcPet} from "./interfaces/IArcPet.sol";

/// @title PetRenderer
/// @notice Pure genes + state -> tokenURI (D11). Procedural bitmask sprites, no hand-drawn art, SVG < 8 KB.
/// @dev Contract: docs/SPEC.md §7.
///      - Reads species/palette/eyes/mood from `p` (already decoded by PetLib); never re-derives gene bits.
///      - `p` derived fields were computed at `nowTs` (== p.asOf).
///      - `p.name` is validated restricted ASCII (PetLib.isValidName), but it is escaped anyway (JSON and XML)
///        so the renderer stays safe if the name rule is ever relaxed.
///
///      Sprites: every layer is a 12x12 bitmask packed in a uint256, bit (y * 12 + x) = pixel (x, y), x = column
///      from the left, y = row from the top. Each layer becomes one `<path>` of horizontal runs
///      (`M{x} {y}h{n}v1h-{n}z`), drawn inside a group scaled x6 on a 120x120 viewBox. Layer order:
///      body (palette body colour) -> species accent (palette accent) -> eyes + mouth (ink) -> tear (sad only).
library PetRenderer {
    // ---------------------------------------------------------------- sprite bitmasks (12x12)
    // Packed from 12x12 ASCII art (bit y*12+x = pixel x,y). Rendered: docs/samples/ via script/RenderSamples.s.sol.

    uint256 private constant BLOB = 0x30c7feffffffffffff7fe7fe3fc0f0000000;
    uint256 private constant CAT = 0x30c3fc3fc3fc7feffffff7fe7fe70e606402;
    uint256 private constant BIRD = 0x18c1083fc7fefff7fe3fc3fc1f80f0060000;
    uint256 private constant BUNNY = 0x00070e3fc3fc7fe7fe7fe7fe3fc30c30c30c;

    uint256 private constant BLOB_ACCENT = 0x000000000000402000000000000000000000; // cheeks
    uint256 private constant CAT_ACCENT = 0x000000000000000000000000000204000000; // inner ears
    uint256 private constant BIRD_ACCENT = 0x18c108000402c03000000000000000000000; // wings + feet
    uint256 private constant BUNNY_ACCENT = 0x000000000000402000000000000108108000; // inner ears + cheeks

    uint256 private constant EYES_DOT = 0x000000000000000000090000000000000000;
    uint256 private constant EYES_BIG = 0x000000000000000000198198000000000000;
    uint256 private constant EYES_WIDE = 0x000000000000000000198000000000000000;
    uint256 private constant EYES_TALL = 0x000000000000000000090090000000000000;

    uint256 private constant MOUTH_HAPPY = 0x000000000060090000000000000000000000;
    uint256 private constant MOUTH_HUNGRY = 0x000000000060060000000000000000000000;
    uint256 private constant MOUTH_SAD = 0x000000000090060000000000000000000000;
    uint256 private constant TEAR = 0x000000000000008108000000000000000000;

    uint256 private constant EGG = 0x0000f01f83fc3fc3fc3fc1f81f80f0060000;
    uint256 private constant EGG_SPOTS = 0x000000040000010080008040000020000000;

    uint256 private constant TOMB = 0x0003fc3fc3fc3fc3fc3fc3fc3fc1f80f0000;
    uint256 private constant TOMB_CROSS = 0x0000000000000000600600f0060000000000;
    uint256 private constant TOMB_FLOWERS = 0x000a05402000000000000000000000000000;
    uint256 private constant GROUND = 0xfff000000000000000000000000000000000;

    // ---------------------------------------------------------------- colours and labels

    /// @dev 8 palettes x (background, body, accent), 6 hex chars each = 18 chars per palette.
    bytes private constant PALETTES = "e6f7ef7fd6a82f9e6b" "fff0e6ffb38ae0703f" "e8f3ff7fb8f03a7bd5"
        "f3ecffb89cf07a52cc" "fffbe0f5d94ec9a400" "ffecece08080c94848" "eceff38a99ad4f5d73" "fff0f6f59ac5d05893";

    bytes private constant HEX = "0123456789abcdef";
    bytes private constant B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    string private constant INK = "#222";
    uint256 private constant BAR_WIDTH = 42;

    // ---------------------------------------------------------------- public surface

    /// @notice Full ERC-721 metadata URI: data:application/json;base64,<...>.
    function render(uint256 id, IArcPet.PetInfo memory p, uint256 nowTs) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", base64(bytes(metadata(id, p, nowTs))));
    }

    /// @notice The raw JSON that `render` base64-encodes. Exposed for tests and offchain debugging.
    function metadata(uint256 id, IArcPet.PetInfo memory p, uint256 nowTs) internal pure returns (string memory) {
        nowTs; // derived fields in `p` already reflect nowTs (== p.asOf)
        string memory idStr = _u(id);
        return string.concat(
            '{"name":"',
            _escJson(p.name),
            " #",
            idStr,
            '","description":"ArcPet #',
            idStr,
            ": an onchain tamagotchi on Arc. Genes by ArcDraw. Anyone can feed or play; death is permanent.",
            '","image":"data:image/svg+xml;base64,',
            base64(bytes(svg(p))),
            '","attributes":[',
            _attributes(p),
            "]}"
        );
    }

    /// @notice Raw SVG document (not base64) for the pet's current mood. Used by `render` and by tests.
    function svg(IArcPet.PetInfo memory p) internal pure returns (string memory) {
        string memory body;
        string memory footer;
        string memory bg;
        if (p.mood == IArcPet.Mood.Egg) {
            bg = "f4f1ea";
            body = string.concat(_layer(EGG, "#f3ead3"), _layer(EGG_SPOTS, "#c9b58a"));
            footer = _caption("hatching...");
        } else if (p.mood == IArcPet.Mood.Tomb) {
            bg = "e9ecef";
            body = string.concat(
                _layer(GROUND, "#7cb66a"),
                _layer(TOMB, "#9aa0a6"),
                _layer(TOMB_CROSS, "#5f6368"),
                _layer(TOMB_FLOWERS, string.concat("#", _color(p.palette, 1)))
            );
            footer = _caption(string.concat("RIP - ", _u(p.age / 1 days), " days"));
        } else {
            bg = _color(p.palette, 0);
            body = _petLayers(p);
            footer = _bars(p);
        }
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" shape-rendering="crispEdges">',
            '<rect width="120" height="120" fill="#',
            bg,
            '"/><g transform="translate(24 6) scale(6)">',
            body,
            '</g><text x="60" y="98" font-family="monospace" font-size="8" text-anchor="middle" fill="',
            INK,
            '">',
            _escXml(p.name),
            "</text>",
            footer,
            "</svg>"
        );
    }

    // ---------------------------------------------------------------- SVG pieces

    function _petLayers(IArcPet.PetInfo memory p) private pure returns (string memory) {
        (uint256 bodyMask, uint256 accentMask) = _species(p.species);
        uint256 mouth =
            p.mood == IArcPet.Mood.Hungry ? MOUTH_HUNGRY : (p.mood == IArcPet.Mood.Sad ? MOUTH_SAD : MOUTH_HAPPY);
        string memory layers = string.concat(
            _layer(bodyMask, string.concat("#", _color(p.palette, 1))),
            _layer(accentMask, string.concat("#", _color(p.palette, 2))),
            _layer(_eyes(p.eyes) | mouth, INK)
        );
        if (p.mood == IArcPet.Mood.Sad) layers = string.concat(layers, _layer(TEAR, "#4aa8ff"));
        return layers;
    }

    /// @dev Hunger (left) and happiness (right) bars, 0..100 mapped to 0..BAR_WIDTH.
    function _bars(IArcPet.PetInfo memory p) private pure returns (string memory) {
        return string.concat(_bar("14", p.hunger, "#e0703f"), _bar("64", p.happiness, "#d05893"));
    }

    function _bar(string memory x, uint8 value, string memory fill) private pure returns (string memory) {
        return string.concat(
            '<rect x="',
            x,
            '" y="106" width="42" height="5" fill="#fff" stroke="#222" stroke-width=".5"/><rect x="',
            x,
            '" y="106" width="',
            _u((uint256(value) * BAR_WIDTH) / 100),
            '" height="5" fill="',
            fill,
            '"/>'
        );
    }

    function _caption(string memory text) private pure returns (string memory) {
        return string.concat(
            '<text x="60" y="112" font-family="monospace" font-size="7" text-anchor="middle" fill="#555">',
            text,
            "</text>"
        );
    }

    /// @dev One bitmask -> one `<path>` of horizontal runs.
    function _layer(uint256 mask, string memory fill) private pure returns (string memory) {
        bytes memory d;
        for (uint256 y; y < 12; ++y) {
            uint256 row = (mask >> (y * 12)) & 0xfff;
            uint256 x;
            while (row >> x != 0) {
                if ((row >> x) & 1 == 0) {
                    ++x;
                    continue;
                }
                uint256 start = x;
                while (x < 12 && (row >> x) & 1 == 1) ++x;
                string memory n = _u(x - start);
                d = abi.encodePacked(d, "M", _u(start), " ", _u(y), "h", n, "v1h-", n, "z");
            }
        }
        return string.concat('<path fill="', fill, '" d="', string(d), '"/>');
    }

    function _species(uint8 s) private pure returns (uint256 body, uint256 accent) {
        if (s == 0) return (BLOB, BLOB_ACCENT);
        if (s == 1) return (CAT, CAT_ACCENT);
        if (s == 2) return (BIRD, BIRD_ACCENT);
        return (BUNNY, BUNNY_ACCENT);
    }

    function _eyes(uint8 e) private pure returns (uint256) {
        if (e == 0) return EYES_DOT;
        if (e == 1) return EYES_BIG;
        if (e == 2) return EYES_WIDE;
        return EYES_TALL;
    }

    /// @dev slot 0 = background, 1 = body, 2 = accent. Out-of-range palettes wrap (PetLib only yields 0..7).
    function _color(uint8 palette, uint256 slot) private pure returns (string memory) {
        bytes memory out = new bytes(6);
        uint256 off = (uint256(palette) % 8) * 18 + slot * 6;
        for (uint256 i; i < 6; ++i) {
            out[i] = PALETTES[off + i];
        }
        return string(out);
    }

    // ---------------------------------------------------------------- JSON pieces

    function _attributes(IArcPet.PetInfo memory p) private pure returns (string memory) {
        bool hatched = p.mood != IArcPet.Mood.Egg;
        string memory attrs = string.concat(
            _trait("Species", hatched ? speciesName(p.species) : "Unhatched"),
            ",",
            _trait("Palette", hatched ? paletteName(p.palette) : "Unhatched"),
            ",",
            _trait("Eyes", hatched ? eyesName(p.eyes) : "Unhatched"),
            ",",
            _trait("Status", statusName(p.status)),
            ",",
            _trait("Mood", moodName(p.mood)),
            ",",
            _trait("Name", _escJson(p.name))
        );
        attrs = string.concat(
            attrs,
            ',{"trait_type":"Age (days)","display_type":"number","value":',
            _u(p.age / 1 days),
            '},{"trait_type":"Hunger","value":',
            _u(p.hunger),
            ',"max_value":100},{"trait_type":"Happiness","value":',
            _u(p.happiness),
            ',"max_value":100}'
        );
        if (p.status == IArcPet.Status.Dead || p.status == IArcPet.Status.Buried) {
            uint64 died = p.status == IArcPet.Status.Buried ? p.diedAt : p.deathAt;
            attrs = string.concat(attrs, ',{"trait_type":"Died","display_type":"date","value":', _u(died), "}");
        }
        return attrs;
    }

    /// @dev `value` must already be JSON-safe.
    function _trait(string memory traitType, string memory value) private pure returns (string memory) {
        return string.concat('{"trait_type":"', traitType, '","value":"', value, '"}');
    }

    // ---------------------------------------------------------------- display names (shared convention, SPEC §4)

    function speciesName(uint8 s) internal pure returns (string memory) {
        if (s == 0) return "Blob";
        if (s == 1) return "Cat";
        if (s == 2) return "Bird";
        return "Bunny";
    }

    function paletteName(uint8 p) internal pure returns (string memory) {
        uint256 i = uint256(p) % 8;
        if (i == 0) return "Mint";
        if (i == 1) return "Peach";
        if (i == 2) return "Sky";
        if (i == 3) return "Lilac";
        if (i == 4) return "Lemon";
        if (i == 5) return "Coral";
        if (i == 6) return "Slate";
        return "Rose";
    }

    function eyesName(uint8 e) internal pure returns (string memory) {
        if (e == 0) return "Dot";
        if (e == 1) return "Big";
        if (e == 2) return "Wide";
        return "Tall";
    }

    function statusName(IArcPet.Status s) internal pure returns (string memory) {
        if (s == IArcPet.Status.Egg) return "Egg";
        if (s == IArcPet.Status.Alive) return "Alive";
        if (s == IArcPet.Status.Dead) return "Dead";
        if (s == IArcPet.Status.Buried) return "Buried";
        return "None";
    }

    function moodName(IArcPet.Mood m) internal pure returns (string memory) {
        if (m == IArcPet.Mood.Egg) return "Egg";
        if (m == IArcPet.Mood.Happy) return "Happy";
        if (m == IArcPet.Mood.Hungry) return "Hungry";
        if (m == IArcPet.Mood.Sad) return "Sad";
        return "Tomb";
    }

    // ---------------------------------------------------------------- escaping

    /// @notice JSON string escaping: `"` and `\` get a backslash, bytes < 0x20 become \u00XX. Other bytes pass.
    function _escJson(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 6);
        uint256 j;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (c == '"' || c == "\\") {
                out[j++] = "\\";
                out[j++] = c;
            } else if (uint8(c) < 0x20) {
                out[j++] = "\\";
                out[j++] = "u";
                out[j++] = "0";
                out[j++] = "0";
                out[j++] = HEX[uint8(c) >> 4];
                out[j++] = HEX[uint8(c) & 0xf];
            } else {
                out[j++] = c;
            }
        }
        assembly ("memory-safe") {
            mstore(out, j)
        }
        return string(out);
    }

    /// @notice XML text escaping: & < > " ' become entities; control bytes (< 0x20, 0x7f), which XML 1.0 forbids
    ///         even as references, become '?'.
    function _escXml(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 6);
        uint256 j;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bytes memory rep;
            if (c == "&") rep = "&amp;";
            else if (c == "<") rep = "&lt;";
            else if (c == ">") rep = "&gt;";
            else if (c == '"') rep = "&quot;";
            else if (c == "'") rep = "&#39;";
            if (rep.length != 0) {
                for (uint256 k; k < rep.length; ++k) {
                    out[j++] = rep[k];
                }
            } else if (uint8(c) < 0x20 || uint8(c) == 0x7f) {
                out[j++] = "?";
            } else {
                out[j++] = c;
            }
        }
        assembly ("memory-safe") {
            mstore(out, j)
        }
        return string(out);
    }

    // ---------------------------------------------------------------- encoding helpers

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 t = v; t != 0; t /= 10) {
            ++len;
        }
        bytes memory out = new bytes(len);
        while (v != 0) {
            // casting to 'uint8' is safe because v % 10 < 10
            // forge-lint: disable-next-line(unsafe-typecast)
            out[--len] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(out);
    }

    /// @notice Standard base64 (RFC 4648, with padding).
    function base64(bytes memory data) internal pure returns (string memory) {
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory table = B64;
        bytes memory out = new bytes(4 * ((len + 2) / 3));
        assembly ("memory-safe") {
            let tablePtr := add(table, 1)
            let outPtr := add(out, 0x20)
            let dataPtr := data
            let endPtr := add(data, len)
            // the loop reads up to 2 bytes past the end; zero them and restore afterwards
            let afterPtr := add(endPtr, 0x20)
            let afterCache := mload(afterPtr)
            mstore(afterPtr, 0)
            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(outPtr, mload(add(tablePtr, and(shr(18, input), 0x3f))))
                mstore8(add(outPtr, 1), mload(add(tablePtr, and(shr(12, input), 0x3f))))
                mstore8(add(outPtr, 2), mload(add(tablePtr, and(shr(6, input), 0x3f))))
                mstore8(add(outPtr, 3), mload(add(tablePtr, and(input, 0x3f))))
                outPtr := add(outPtr, 4)
            }
            mstore(afterPtr, afterCache)
            switch mod(len, 3)
            case 1 {
                mstore8(sub(outPtr, 1), 0x3d)
                mstore8(sub(outPtr, 2), 0x3d)
            }
            case 2 { mstore8(sub(outPtr, 1), 0x3d) }
        }
        return string(out);
    }
}
