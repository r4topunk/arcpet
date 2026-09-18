// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IArcDrawCoordinator} from "../vendor/arcdraw/interfaces/IArcDrawCoordinator.sol";

/// @title IArcPet
/// @notice Onchain tamagotchi on Arc. One soulbound ERC-721 pet per wallet at a time, genes drawn by ArcDraw,
///         stats that decay by formula (no keeper), permanent death that leaves a tombstone.
/// @dev Binding behaviour lives in docs/SPEC.md (derived from PLAN-ARCPET.md rev. 2, D1-D17 / R1-R9).
///      Gene layout and stat math are implemented once, in `src/libraries/PetLib.sol`; ArcPet and PetRenderer
///      MUST use it instead of re-deriving bits or formulas.
///
///      Lifecycle (see SPEC §2):
///        None --hatch--> Egg --fulfill callback | claimGenes--> Alive --(now >= deathAt)--> Dead --bury--> Buried
///      Egg never decays and never expires. Alive -> Dead is a pure function of time (no tx). Dead -> Buried is
///      the only write that records death (`bury`, or `hatch` by the same owner, which auto-buries).
///
///      Soulbound (D2): ArcPet exposes the ERC-721 + ERC-721 Metadata read surface and ERC-5192 `locked`, and every
///      transfer/approval entry point reverts with `Soulbound()`. The only `Transfer` event ever emitted is the mint.
interface IArcPet {
    // ---------------------------------------------------------------- types

    /// @notice Lifecycle status at a given timestamp. `Dead` = deathAt passed but not yet buried (a view fact);
    ///         `Buried` = `diedAt` recorded onchain. Both render as a tombstone.
    enum Status {
        None, // id does not exist (never returned by petInfo, which reverts instead)
        Egg, // minted, genes not assigned yet; does not decay
        Alive, // hatched and block.timestamp < deathAt
        Dead, // hatched and block.timestamp >= deathAt, diedAt == 0
        Buried // diedAt != 0 (== deathAt, frozen forever)
    }

    /// @notice Sprite/state selector shared by the renderer, the SDK and the web app. Computed by `PetLib.moodOf`.
    enum Mood {
        Egg,
        Happy, // alive, hunger >= 30 and happiness >= 30
        Hungry, // alive, hunger < 30 (takes priority over Sad)
        Sad, // alive, hunger >= 30 and happiness < 30
        Tomb // Dead or Buried
    }

    /// @notice Everything the front end and the renderer need about one pet, as of `asOf`.
    /// @dev Returned by `petInfo(id)` (asOf = block.timestamp) and passed to `PetRenderer.render`.
    ///      Raw fields are storage; derived fields are computed by `PetLib` at `asOf`.
    struct PetInfo {
        // identity
        uint256 id;
        address owner;
        string name; // 1..20 bytes, restricted ASCII (SPEC §5)
        bytes32 genes; // 0 while Egg; == ArcDraw randomness of `requestId` afterwards
        uint256 requestId; // ArcDraw request that decides the genes
        // raw timestamps (unix seconds; 0 = not set)
        uint64 laidAt; // hatch() tx
        uint64 bornAt; // genes assigned (callback or claimGenes)
        uint64 lastFed;
        uint64 lastPlayed;
        uint64 diedAt; // set only by bury (or auto-bury in hatch); == deathAt at that moment
        // gene-derived windows (seconds; 0 while Egg)
        uint32 hungerWindow; // TH: hunger 100 -> 0 in this many seconds (24h base, +-20% by genes)
        uint32 playWindow; // TP: happiness 100 -> 0 in this many seconds (48h base, +-20% by genes)
        // derived at asOf
        uint64 asOf;
        Status status;
        Mood mood;
        uint64 deathAt; // min(lastFed + TH, lastPlayed + TP); 0 while Egg
        uint64 age; // seconds since bornAt; frozen at deathAt - bornAt once dead; 0 while Egg
        uint8 hunger; // 0..100; 100 while Egg; 0..100 clamped at asOf otherwise
        uint8 happiness; // 0..100; same rules as hunger
        // decoded genes (0 while Egg)
        uint8 species; // 0..3
        uint8 palette; // 0..7
        uint8 eyes; // 0..3
    }

    // ---------------------------------------------------------------- events

    /// @notice ERC-721 mint (from = 0). Never emitted with a non-zero `from`: pets are soulbound.
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /// @notice ERC-5192: emitted at mint; the token is locked forever.
    event Locked(uint256 tokenId);

    /// @notice hatch(): egg minted and ArcDraw randomness requested for `round`.
    event EggLaid(uint256 indexed id, address indexed owner, uint256 indexed requestId, uint64 round, string name);

    /// @notice Genes assigned; the pet is born with hunger = happiness = 100.
    /// @param viaClaim true when completed by `claimGenes` (callback failed), false when by the ArcDraw callback.
    event Hatched(uint256 indexed id, bytes32 genes, uint64 bornAt, uint64 deathAt, bool viaClaim);

    /// @notice feed(): hunger reset to 100 by `caller` (any wallet, R1/D7).
    event Fed(uint256 indexed id, address indexed caller, uint64 deathAt);

    /// @notice play(): happiness reset to 100 by `caller` (any wallet, R1/D7).
    event Played(uint256 indexed id, address indexed caller, uint64 deathAt);

    /// @notice bury() or auto-bury in hatch(): death recorded. `age` = diedAt - bornAt.
    event Died(uint256 indexed id, address indexed buriedBy, uint64 diedAt, uint64 age);

    // ---------------------------------------------------------------- errors

    error NonexistentPet(uint256 id);
    /// @notice feed/play on a pet whose deathAt has passed (buried or not). No grace window (D6).
    error PetDead(uint256 id, uint64 deathAt);
    /// @notice Action needs a hatched pet (feed, play, bury on an egg).
    error NotHatched(uint256 id);
    /// @notice claimGenes on a pet that already has genes (genes are never overwritten).
    error AlreadyHatched(uint256 id);
    /// @notice bury on a pet that is still alive.
    error NotDead(uint256 id, uint64 deathAt);
    error AlreadyBuried(uint256 id);
    /// @notice hatch while the caller's current pet is an Egg or Alive (D3: one living pet or egg per wallet).
    error AlreadyHasPet(address owner, uint256 id);
    /// @notice Name empty, longer than 20 bytes, or with a byte outside the allowed set (SPEC §5).
    error InvalidName();
    /// @notice claimGenes before the coordinator marked the request Fulfilled.
    error RequestNotFulfilled(uint256 id, uint256 requestId, IArcDrawCoordinator.Status status);
    /// @notice Any transfer/approval entry point (D2).
    error Soulbound();

    // ---------------------------------------------------------------- lifecycle

    /// @notice Mint an egg to msg.sender and request ArcDraw randomness (callbackGasLimit 100_000, bounty 0).
    /// @dev Reverts AlreadyHasPet if msg.sender's current pet is Egg or Alive. If it is Dead (not buried),
    ///      buries it first in the same tx (emits Died with buriedBy = msg.sender) (R6).
    /// @param name 1..20 bytes of restricted ASCII (SPEC §5), else InvalidName.
    function hatch(string calldata name) external returns (uint256 id, uint256 requestId);

    /// @notice Fallback when the ArcDraw callback failed (R2): if the coordinator request is Fulfilled and the pet
    ///         is still an Egg, read `getRequest(requestId).randomness` and complete the hatch. Permissionless.
    /// @dev Reverts NonexistentPet, AlreadyHatched, RequestNotFulfilled. Never overwrites genes.
    function claimGenes(uint256 id) external;

    /// @notice Reset hunger to 100 (lastFed = now). Any caller (R1/D7). Reverts NotHatched / PetDead.
    function feed(uint256 id) external;

    /// @notice Reset happiness to 100 (lastPlayed = now). Any caller (R1/D7). Reverts NotHatched / PetDead.
    function play(uint256 id) external;

    /// @notice Record death: diedAt = deathAt(id). Permissionless. Reverts NotHatched / NotDead / AlreadyBuried.
    function bury(uint256 id) external;

    // ---------------------------------------------------------------- views

    /// @notice min(lastFed + TH, lastPlayed + TP). 0 while Egg. Reverts NonexistentPet.
    function deathAt(uint256 id) external view returns (uint64);

    /// @notice Hatched and block.timestamp < deathAt(id). False for eggs. Reverts NonexistentPet.
    function isAlive(uint256 id) external view returns (bool);

    /// @notice Full state as of block.timestamp (multicall-friendly, R5/D12). Reverts NonexistentPet.
    function petInfo(uint256 id) external view returns (PetInfo memory);

    /// @notice Number of pets ever minted. Ids are sequential: 1..totalSupply() (never burned).
    function totalSupply() external view returns (uint256);

    /// @notice The wallet's most recent pet id (any status), 0 if it never hatched.
    function petOf(address owner) external view returns (uint256);

    /// @notice Pet id for an ArcDraw request id, 0 if unknown.
    function petByRequest(uint256 requestId) external view returns (uint256);

    // ---------------------------------------------------------------- ERC-721 / Metadata / ERC-5192 / ERC-165

    function name() external view returns (string memory); // "ArcPet"
    function symbol() external view returns (string memory); // "PET"
    /// @notice data:application/json;base64,... built by PetRenderer.render(id, petInfo(id), block.timestamp).
    function tokenURI(uint256 id) external view returns (string memory);
    function balanceOf(address owner) external view returns (uint256); // all pets ever owned, incl. dead
    function ownerOf(uint256 id) external view returns (address);
    function getApproved(uint256 id) external view returns (address); // always address(0) (after existence check)
    function isApprovedForAll(address owner, address operator) external view returns (bool); // always false
    function locked(uint256 id) external view returns (bool); // ERC-5192: always true (after existence check)
    /// @notice true for 0x01ffc9a7 (ERC-165), 0x80ac58cd (ERC-721), 0x5b5e139f (Metadata), 0xb45a3c0e (ERC-5192).
    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    /// @dev All revert Soulbound().
    function approve(address to, uint256 id) external;
    function setApprovalForAll(address operator, bool approved) external;
    function transferFrom(address from, address to, uint256 id) external;
    function safeTransferFrom(address from, address to, uint256 id) external;
    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external;
}
