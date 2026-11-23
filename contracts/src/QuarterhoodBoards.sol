// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title QuarterhoodBoards
/// @notice Every Monday, Quarterhood writes one Merkle root per finished week: the top rows of every weekly board
///         (game, mode, rank, player, score, run id, replay hash). Once a week is committed it can never change,
///         so anyone can prove later that a board shown on the site is the board that was locked that Monday.
/// @dev    No funds, no tokens, no upgrades. Only the operator wallet set at deploy time can commit, and only once
///         per week. Leaf and tree format: see `leafOf` and the README.
contract QuarterhoodBoards {
    /// @notice The only address allowed to commit. Fixed at deploy.
    address public immutable operator;

    /// @notice week (UTC Monday as "YYYY-MM-DD", left-aligned in bytes32) => Merkle root of that week's boards.
    mapping(bytes32 week => bytes32 root) public rootOf;

    event WeekCommitted(bytes32 indexed week, bytes32 root, uint32 boards, uint32 rows);

    error NotOperator();
    error AlreadyCommitted(bytes32 week);
    error EmptyRoot();

    constructor(address operator_) {
        operator = operator_;
    }

    /// @notice Lock a finished week. `boards` and `rows` are informational counts for the event.
    function commit(bytes32 week, bytes32 root, uint32 boards, uint32 rows) external {
        if (msg.sender != operator) revert NotOperator();
        if (root == bytes32(0)) revert EmptyRoot();
        if (rootOf[week] != bytes32(0)) revert AlreadyCommitted(week);
        rootOf[week] = root;
        emit WeekCommitted(week, root, boards, rows);
    }

    /// @notice The leaf for one board row. Off-chain code must hash rows exactly like this.
    function leafOf(
        bytes32 week,
        bytes32 game,
        bytes32 mode,
        uint32 rank,
        address player,
        uint64 score,
        bytes16 runId,
        uint32 replayHash
    ) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(week, game, mode, rank, player, score, runId, replayHash))));
    }

    /// @notice Checks a row against a committed week (sorted-pair Merkle proof, same as OpenZeppelin MerkleProof).
    function verify(bytes32 week, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encode(h, p)) : keccak256(abi.encode(p, h));
        }
        bytes32 root = rootOf[week];
        return root != bytes32(0) && h == root;
    }
}
