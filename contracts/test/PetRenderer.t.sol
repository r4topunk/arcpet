// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IArcPet} from "../src/interfaces/IArcPet.sol";
import {PetRenderer} from "../src/PetRenderer.sol";

/// @dev External wrapper so tests can measure a real (pure) call, like an explorer's eth_call of tokenURI.
contract PetRendererHarness {
    function render(uint256 id, IArcPet.PetInfo memory p, uint256 nowTs) external pure returns (string memory) {
        return PetRenderer.render(id, p, nowTs);
    }

    function metadata(uint256 id, IArcPet.PetInfo memory p, uint256 nowTs) external pure returns (string memory) {
        return PetRenderer.metadata(id, p, nowTs);
    }

    function svg(IArcPet.PetInfo memory p) external pure returns (string memory) {
        return PetRenderer.svg(p);
    }

    function base64(bytes memory data) external pure returns (string memory) {
        return PetRenderer.base64(data);
    }

    function escJson(string memory s) external pure returns (string memory) {
        return PetRenderer._escJson(s);
    }

    function escXml(string memory s) external pure returns (string memory) {
        return PetRenderer._escXml(s);
    }
}

/// @notice PetRenderer (D11, SPEC §7): SVG size bound, JSON validity, escaping, attributes, worst-case gas.
contract PetRendererTest is Test {
    uint256 internal constant MAX_SVG_BYTES = 8192;
    uint64 internal constant T0 = 1_790_000_000;

    /// @dev Worst case for size: 20 bytes that each expand 5x in XML (`&` -> `&amp;`).
    string internal constant WORST_NAME = "&&&&&&&&&&&&&&&&&&&&";

    PetRendererHarness internal h;

    function setUp() public {
        h = new PetRendererHarness();
    }

    // ---------------------------------------------------------------- fixtures

    function _pet(uint8 species, uint8 palette, uint8 eyes, IArcPet.Mood mood, string memory name)
        internal
        pure
        returns (IArcPet.PetInfo memory p)
    {
        p.id = 42;
        p.owner = address(0xBEEF);
        p.name = name;
        p.requestId = 7;
        p.laidAt = T0;
        p.asOf = T0 + 3 days + 5 hours;
        p.mood = mood;
        if (mood == IArcPet.Mood.Egg) {
            p.status = IArcPet.Status.Egg;
            p.hunger = 100;
            p.happiness = 100;
            return p;
        }
        p.genes = bytes32(uint256(species) | (uint256(palette) << 2) | (uint256(eyes) << 5));
        p.species = species;
        p.palette = palette;
        p.eyes = eyes;
        p.bornAt = T0 + 60;
        p.hungerWindow = 86_400;
        p.playWindow = 172_800;
        p.lastFed = T0 + 2 days;
        p.lastPlayed = T0 + 2 days;
        p.deathAt = p.lastFed + p.hungerWindow;
        p.age = p.asOf - p.bornAt;
        p.status = IArcPet.Status.Alive;
        p.hunger = 80;
        p.happiness = 90;
        if (mood == IArcPet.Mood.Hungry) p.hunger = 12;
        if (mood == IArcPet.Mood.Sad) p.happiness = 7;
        if (mood == IArcPet.Mood.Tomb) {
            p.status = IArcPet.Status.Buried;
            p.hunger = 0;
            p.happiness = 0;
            p.diedAt = p.deathAt;
            p.age = p.deathAt - p.bornAt;
        }
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory a = bytes(hay);
        bytes memory b = bytes(needle);
        if (b.length > a.length) return false;
        for (uint256 i; i <= a.length - b.length; ++i) {
            bool ok = true;
            for (uint256 j; j < b.length; ++j) {
                if (a[i + j] != b[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- size bound

    /// @notice Every species x palette x eyes x mood (plus egg and tomb) stays under 8 KB with the worst-case name.
    function test_svgSize_allCombinations_under8KB() public view {
        uint256 maxLen;
        IArcPet.PetInfo memory p = _pet(0, 0, 0, IArcPet.Mood.Egg, WORST_NAME);
        maxLen = bytes(h.svg(p)).length;
        for (uint8 s; s < 4; ++s) {
            for (uint8 pal; pal < 8; ++pal) {
                for (uint8 e; e < 4; ++e) {
                    for (uint8 m = 1; m <= 4; ++m) {
                        p = _pet(s, pal, e, IArcPet.Mood(m), WORST_NAME);
                        uint256 len = bytes(h.svg(p)).length;
                        assertLt(len, MAX_SVG_BYTES, "svg over 8 KB");
                        if (len > maxLen) maxLen = len;
                    }
                }
            }
        }
        console2.log("max SVG bytes (worst-case name):", maxLen);
        assertLt(maxLen, MAX_SVG_BYTES);
    }

    function test_tokenUriSize_worstCase() public view {
        uint256 maxLen;
        for (uint8 s; s < 4; ++s) {
            for (uint8 m = 1; m <= 4; ++m) {
                IArcPet.PetInfo memory p = _pet(s, 7, 1, IArcPet.Mood(m), WORST_NAME);
                uint256 len = bytes(h.render(type(uint256).max, p, p.asOf)).length;
                if (len > maxLen) maxLen = len;
            }
        }
        console2.log("max tokenURI bytes:", maxLen);
        // base64(JSON with base64(SVG)) ~ 16/9 x SVG + attributes
        assertLt(maxLen, 16_384);
    }

    // ---------------------------------------------------------------- gas

    /// @notice Worst-case render through an external pure call (what an explorer's eth_call of tokenURI pays).
    function test_renderGas_worstCase() public view {
        IArcPet.PetInfo memory p = _pet(1, 7, 1, IArcPet.Mood.Sad, WORST_NAME); // most runs + tear layer
        uint256 g = gasleft();
        h.render(type(uint256).max, p, p.asOf);
        uint256 used = g - gasleft();
        console2.log("worst-case render gas:", used);
        assertLt(used, 5_000_000);
    }

    // ---------------------------------------------------------------- encoding

    function testFuzz_base64_matchesReference(bytes memory data) public view {
        assertEq(h.base64(data), vm.toBase64(data));
    }

    function test_base64_paddingEdges() public view {
        assertEq(h.base64(""), "");
        assertEq(h.base64("f"), "Zg==");
        assertEq(h.base64("fo"), "Zm8=");
        assertEq(h.base64("foo"), "Zm9v");
        assertEq(h.base64("foob"), "Zm9vYg==");
    }

    function test_render_isBase64OfMetadata() public view {
        IArcPet.PetInfo memory p = _pet(2, 3, 2, IArcPet.Mood.Happy, "Pixel");
        string memory json = h.metadata(9, p, p.asOf);
        assertEq(h.render(9, p, p.asOf), string.concat("data:application/json;base64,", vm.toBase64(json)));
        string memory image = vm.parseJsonString(json, ".image");
        assertEq(image, string.concat("data:image/svg+xml;base64,", vm.toBase64(h.svg(p))));
    }

    // ---------------------------------------------------------------- JSON content

    function test_metadata_aliveAttributes() public view {
        IArcPet.PetInfo memory p = _pet(1, 5, 3, IArcPet.Mood.Hungry, "Mochi");
        string memory json = h.metadata(3, p, p.asOf);
        assertEq(vm.parseJsonString(json, ".name"), "Mochi #3");
        assertEq(vm.parseJsonString(json, ".attributes[0].value"), "Cat");
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "Coral");
        assertEq(vm.parseJsonString(json, ".attributes[2].value"), "Tall");
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Alive");
        assertEq(vm.parseJsonString(json, ".attributes[4].value"), "Hungry");
        assertEq(vm.parseJsonString(json, ".attributes[5].value"), "Mochi");
        assertEq(vm.parseJsonUint(json, ".attributes[6].value"), 3); // age 3d 5h - 60s -> 3 days
        assertEq(vm.parseJsonUint(json, ".attributes[7].value"), 12);
        assertEq(vm.parseJsonUint(json, ".attributes[8].value"), 90);
        assertFalse(_contains(json, '"Died"'));
    }

    function test_metadata_eggIsUnhatched() public view {
        IArcPet.PetInfo memory p = _pet(0, 0, 0, IArcPet.Mood.Egg, "Eggy");
        string memory json = h.metadata(1, p, p.asOf);
        assertEq(vm.parseJsonString(json, ".attributes[0].value"), "Unhatched");
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Egg");
        assertEq(vm.parseJsonString(json, ".attributes[4].value"), "Egg");
        assertEq(vm.parseJsonUint(json, ".attributes[6].value"), 0);
        assertTrue(_contains(h.svg(p), "hatching..."));
    }

    function test_metadata_buriedHasDiedDateAndTombShowsAge() public view {
        IArcPet.PetInfo memory p = _pet(3, 2, 0, IArcPet.Mood.Tomb, "Old Tom");
        string memory json = h.metadata(5, p, p.asOf);
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Buried");
        assertEq(vm.parseJsonString(json, ".attributes[4].value"), "Tomb");
        assertEq(vm.parseJsonString(json, ".attributes[9].trait_type"), "Died");
        assertEq(vm.parseJsonString(json, ".attributes[9].display_type"), "date");
        assertEq(vm.parseJsonUint(json, ".attributes[9].value"), p.diedAt);
        string memory s = h.svg(p);
        assertTrue(_contains(s, ">Old Tom</text>"));
        assertTrue(_contains(s, "RIP - 2 days")); // deathAt - bornAt = 3 days - 60 s
    }

    function test_metadata_deadUsesDeathAt() public view {
        IArcPet.PetInfo memory p = _pet(0, 1, 1, IArcPet.Mood.Tomb, "Ghost");
        p.status = IArcPet.Status.Dead;
        p.diedAt = 0;
        string memory json = h.metadata(6, p, p.asOf);
        assertEq(vm.parseJsonString(json, ".attributes[3].value"), "Dead");
        assertEq(vm.parseJsonUint(json, ".attributes[9].value"), p.deathAt);
    }

    // ---------------------------------------------------------------- escaping

    function test_escaping_hostileName() public view {
        string memory name = string(abi.encodePacked("a\"b\\c<d>&e'", bytes1(0x0a), bytes1(0x01), bytes1(0x7f)));
        IArcPet.PetInfo memory p = _pet(0, 0, 0, IArcPet.Mood.Happy, name);
        string memory json = h.metadata(1, p, p.asOf);
        // JSON parses and round-trips the exact name
        assertEq(vm.parseJsonString(json, ".name"), string.concat(name, " #1"));
        assertEq(vm.parseJsonString(json, ".attributes[5].value"), name);
        // SVG text is entity-escaped and control bytes are replaced
        assertEq(h.escXml(name), "a&quot;b\\c&lt;d&gt;&amp;e&#39;???");
        assertTrue(_contains(h.svg(p), ">a&quot;b\\c&lt;d&gt;&amp;e&#39;???</text>"));
        assertEq(h.escJson(name), "a\\\"b\\\\c<d>&e'\\u000a\\u0001\x7f");
    }

    /// @notice Any 1..20-byte ASCII name keeps the JSON valid and the SVG text free of markup.
    function testFuzz_escaping_asciiNames(bytes memory raw) public view {
        uint256 len = bound(raw.length, 1, 20);
        bytes memory n = new bytes(len);
        for (uint256 i; i < len; ++i) {
            n[i] = i < raw.length ? raw[i] & 0x7f : bytes1(0x78); // ASCII only, "x" padding
        }
        string memory name = string(n);
        IArcPet.PetInfo memory p = _pet(1, 1, 1, IArcPet.Mood.Sad, name);
        assertEq(vm.parseJsonString(h.metadata(1, p, p.asOf), ".name"), string.concat(name, " #1"));
        bytes memory x = bytes(h.escXml(name));
        for (uint256 i; i < x.length; ++i) {
            bytes1 c = x[i];
            assertTrue(c != "<" && c != ">" && c != '"' && c != "'" && uint8(c) >= 0x20 && uint8(c) != 0x7f);
        }
    }

    // ---------------------------------------------------------------- sprites

    function test_svg_moodsDiffer() public view {
        string memory happy = h.svg(_pet(0, 0, 0, IArcPet.Mood.Happy, "A"));
        string memory hungry = h.svg(_pet(0, 0, 0, IArcPet.Mood.Hungry, "A"));
        string memory sad = h.svg(_pet(0, 0, 0, IArcPet.Mood.Sad, "A"));
        assertNotEq(keccak256(bytes(happy)), keccak256(bytes(hungry)));
        assertNotEq(keccak256(bytes(happy)), keccak256(bytes(sad)));
        assertNotEq(keccak256(bytes(hungry)), keccak256(bytes(sad)));
        assertTrue(_contains(sad, "#4aa8ff")); // tear
        assertFalse(_contains(happy, "#4aa8ff"));
    }

    function test_svg_speciesPaletteEyesDiffer() public view {
        bytes32 base = keccak256(bytes(h.svg(_pet(0, 0, 0, IArcPet.Mood.Happy, "A"))));
        for (uint8 s = 1; s < 4; ++s) {
            assertNotEq(keccak256(bytes(h.svg(_pet(s, 0, 0, IArcPet.Mood.Happy, "A")))), base);
        }
        for (uint8 pal = 1; pal < 8; ++pal) {
            assertNotEq(keccak256(bytes(h.svg(_pet(0, pal, 0, IArcPet.Mood.Happy, "A")))), base);
        }
        for (uint8 e = 1; e < 4; ++e) {
            assertNotEq(keccak256(bytes(h.svg(_pet(0, 0, e, IArcPet.Mood.Happy, "A")))), base);
        }
    }

    function test_svg_barsTrackStats() public view {
        IArcPet.PetInfo memory p = _pet(0, 0, 0, IArcPet.Mood.Happy, "A");
        p.hunger = 100;
        p.happiness = 50;
        string memory s = h.svg(p);
        assertTrue(_contains(s, '<rect x="14" y="106" width="42" height="5" fill="#e0703f"/>'));
        assertTrue(_contains(s, '<rect x="64" y="106" width="21" height="5" fill="#d05893"/>'));
    }
}
