// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ArcDrawConsumer} from "./vendor/arcdraw/ArcDrawConsumer.sol";
import {IArcDrawCoordinator} from "./vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";
import {IArcPet} from "./interfaces/IArcPet.sol";
import {PetLib} from "./libraries/PetLib.sol";
import {PetRenderer} from "./PetRenderer.sol";

/// @title ArcPet
/// @notice Soulbound ERC-721 tamagotchi whose genes come from ArcDraw. Immutable, no owner, no pause, holds no USDC.
/// @dev Behaviour contract: IArcPet + docs/SPEC.md. Gene/decay/mood/name math: PetLib only.
///      Stats are never stored: a pet keeps `lastFed` / `lastPlayed` and every view derives hunger, happiness and
///      death from block.timestamp. `diedAt` is the only record of death and is written once (bury / auto-bury).
contract ArcPet is IArcPet, ArcDrawConsumer {
    /// @notice Gas forwarded to rawFulfillRandomness (D8; coordinator max is 500_000).
    uint32 public constant CALLBACK_GAS_LIMIT = 100_000;

    /// @dev Storage per pet, packed so the callback writes two fresh slots and feed/play touch one slot.
    struct Pet {
        // slot 0 (hatch)
        address owner;
        uint64 laidAt;
        // slot 1 (callback / claimGenes; feed and play rewrite it)
        uint64 bornAt; // 0 while Egg
        uint64 lastFed;
        uint64 lastPlayed;
        uint32 hungerWindow; // TH, cached from genes at birth (never changes)
        uint32 playWindow; // TP, cached from genes at birth (never changes)
        // slot 2 (callback / claimGenes; written once)
        bytes32 genes;
        // slot 3 (hatch)
        uint256 requestId;
        // slot 4 (bury / auto-bury; written once)
        uint64 diedAt;
        // slot 5 (hatch)
        string name;
    }

    uint256 private _totalSupply;
    mapping(uint256 id => Pet) private _pets;
    mapping(address owner => uint256 id) private _petOf;
    mapping(address owner => uint256 count) private _balanceOf;
    mapping(uint256 requestId => uint256 id) private _petByRequest;

    constructor(IArcDrawCoordinator coordinator_) ArcDrawConsumer(coordinator_) {}

    // ---------------------------------------------------------------- ArcDraw callback

    /// @dev Must never revert (a revert is swallowed by the coordinator and leaves the egg for claimGenes).
    ///      Unknown request ids and pets that already have genes are ignored.
    function _fulfillRandomness(uint256 requestId, bytes32 randomness) internal override {
        uint256 id = _petByRequest[requestId];
        if (id == 0) return;
        if (_pets[id].bornAt != 0) return;
        _hatch(id, randomness, false);
    }

    // ---------------------------------------------------------------- lifecycle

    /// @inheritdoc IArcPet
    function hatch(string calldata name_) external returns (uint256 id, uint256 requestId) {
        if (!PetLib.isValidName(bytes(name_))) revert InvalidName();

        uint256 current = _petOf[msg.sender];
        if (current != 0) {
            Pet storage prev = _pets[current];
            Status s = _status(prev, block.timestamp);
            if (s == Status.Egg || s == Status.Alive) revert AlreadyHasPet(msg.sender, current);
            if (s == Status.Dead) _bury(current, prev); // R6
        }

        unchecked {
            id = ++_totalSupply;
            ++_balanceOf[msg.sender];
        }
        uint64 round;
        (requestId, round) = coordinator.requestRandomness(CALLBACK_GAS_LIMIT, 0);

        Pet storage p = _pets[id];
        p.owner = msg.sender;
        p.laidAt = _now();
        p.requestId = requestId;
        p.name = name_;
        _petOf[msg.sender] = id;
        _petByRequest[requestId] = id;

        emit Transfer(address(0), msg.sender, id);
        emit Locked(id);
        emit EggLaid(id, msg.sender, requestId, round, name_);
    }

    /// @inheritdoc IArcPet
    function claimGenes(uint256 id) external {
        Pet storage p = _existing(id);
        if (p.bornAt != 0) revert AlreadyHatched(id);
        uint256 requestId = p.requestId;
        IArcDrawCoordinator.Request memory r = coordinator.getRequest(requestId);
        if (r.status != IArcDrawCoordinator.Status.Fulfilled) revert RequestNotFulfilled(id, requestId, r.status);
        _hatch(id, r.randomness, true);
    }

    /// @inheritdoc IArcPet
    function feed(uint256 id) external {
        Pet storage p = _living(id);
        uint64 t = _now();
        p.lastFed = t;
        emit Fed(id, msg.sender, PetLib.deathAt(t, p.lastPlayed, p.hungerWindow, p.playWindow));
    }

    /// @inheritdoc IArcPet
    function play(uint256 id) external {
        Pet storage p = _living(id);
        uint64 t = _now();
        p.lastPlayed = t;
        emit Played(id, msg.sender, PetLib.deathAt(p.lastFed, t, p.hungerWindow, p.playWindow));
    }

    /// @inheritdoc IArcPet
    function bury(uint256 id) external {
        Pet storage p = _existing(id);
        if (p.bornAt == 0) revert NotHatched(id);
        if (p.diedAt != 0) revert AlreadyBuried(id);
        uint64 d = _deathAt(p);
        if (block.timestamp < d) revert NotDead(id, d);
        _bury(id, p);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IArcPet
    function deathAt(uint256 id) external view returns (uint64) {
        return _deathAt(_existing(id));
    }

    /// @inheritdoc IArcPet
    function isAlive(uint256 id) external view returns (bool) {
        return _status(_existing(id), block.timestamp) == Status.Alive;
    }

    /// @inheritdoc IArcPet
    function petInfo(uint256 id) public view returns (PetInfo memory info) {
        Pet storage p = _existing(id);
        uint256 t = block.timestamp;

        info.id = id;
        info.owner = p.owner;
        info.name = p.name;
        info.genes = p.genes;
        info.requestId = p.requestId;
        info.laidAt = p.laidAt;
        info.bornAt = p.bornAt;
        info.lastFed = p.lastFed;
        info.lastPlayed = p.lastPlayed;
        info.diedAt = p.diedAt;
        info.hungerWindow = p.hungerWindow;
        info.playWindow = p.playWindow;
        info.asOf = _now();

        Status s = _status(p, t);
        info.status = s;
        if (s == Status.Egg) {
            info.hunger = PetLib.STAT_MAX;
            info.happiness = PetLib.STAT_MAX;
        } else {
            uint64 d = _deathAt(p);
            info.deathAt = d;
            info.age = (s == Status.Alive ? info.asOf : d) - p.bornAt;
            info.hunger = PetLib.statAt(p.lastFed, p.hungerWindow, t);
            info.happiness = PetLib.statAt(p.lastPlayed, p.playWindow, t);
            info.species = PetLib.species(p.genes);
            info.palette = PetLib.palette(p.genes);
            info.eyes = PetLib.eyes(p.genes);
        }
        info.mood = PetLib.moodOf(s, info.hunger, info.happiness);
    }

    /// @inheritdoc IArcPet
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    /// @inheritdoc IArcPet
    function petOf(address owner) external view returns (uint256) {
        return _petOf[owner];
    }

    /// @inheritdoc IArcPet
    function petByRequest(uint256 requestId) external view returns (uint256) {
        return _petByRequest[requestId];
    }

    // ---------------------------------------------------------------- ERC-721 / Metadata / ERC-5192 / ERC-165

    function name() external pure returns (string memory) {
        return "ArcPet";
    }

    function symbol() external pure returns (string memory) {
        return "PET";
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        return PetRenderer.render(id, petInfo(id), block.timestamp);
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _balanceOf[owner];
    }

    function ownerOf(uint256 id) external view returns (address) {
        return _existing(id).owner;
    }

    function getApproved(uint256 id) external view returns (address) {
        _existing(id);
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function locked(uint256 id) external view returns (bool) {
        _existing(id);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f
            || interfaceId == 0xb45a3c0e;
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    // ---------------------------------------------------------------- internals

    /// @dev genes, windows and the three birth timestamps. Callers guarantee the pet is an Egg.
    function _hatch(uint256 id, bytes32 genes, bool viaClaim) private {
        Pet storage p = _pets[id];
        uint64 t = _now();
        uint32 th = PetLib.hungerWindow(genes);
        uint32 tp = PetLib.playWindow(genes);
        p.bornAt = t;
        p.lastFed = t;
        p.lastPlayed = t;
        p.hungerWindow = th;
        p.playWindow = tp;
        p.genes = genes;
        emit Hatched(id, genes, t, PetLib.deathAt(t, t, th, tp), viaClaim);
    }

    /// @dev Callers guarantee the pet is Dead (hatched, not buried, now >= deathAt).
    function _bury(uint256 id, Pet storage p) private {
        uint64 d = _deathAt(p);
        p.diedAt = d;
        emit Died(id, msg.sender, d, d - p.bornAt);
    }

    function _existing(uint256 id) private view returns (Pet storage p) {
        p = _pets[id];
        if (p.owner == address(0)) revert NonexistentPet(id);
    }

    /// @dev Existence, then NotHatched, then PetDead (SPEC §2.1 order). Buried pets are past deathAt too.
    function _living(uint256 id) private view returns (Pet storage p) {
        p = _existing(id);
        if (p.bornAt == 0) revert NotHatched(id);
        uint64 d = _deathAt(p);
        if (block.timestamp >= d) revert PetDead(id, d);
    }

    /// @dev 0 for eggs (windows are 0 until birth).
    function _deathAt(Pet storage p) private view returns (uint64) {
        if (p.bornAt == 0) return 0;
        return PetLib.deathAt(p.lastFed, p.lastPlayed, p.hungerWindow, p.playWindow);
    }

    function _status(Pet storage p, uint256 t) private view returns (Status) {
        if (p.bornAt == 0) return Status.Egg;
        if (p.diedAt != 0) return Status.Buried;
        return t < _deathAt(p) ? Status.Alive : Status.Dead;
    }

    function _now() private view returns (uint64) {
        // casting to 'uint64' is safe because unix seconds fit in uint64 until the year 584942417355
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp);
    }
}
