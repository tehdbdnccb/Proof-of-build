// SPDX-Identifier: MIT 
pragma solidity ^0.8.24;

// @title ProofOfBuild
// @notice Immutable, timestamped checkpoints of a builder's work, anchored on Monad
// @dev No admin keys, no upgradability, no pausability. What you see is what runs.
contract ProofOfBuild {
    struct Anchor {
        bytes32 commitHash; // keccak256 of the git commit SHA( or any content hash )
        uint64 timestamp; // block.timestamp at the moment of anchoring
        string label; // short human-readable note, e.g. a commit message 
    }

    /// @dev builder address => their append-only history of anchors 
    mapping(address => Anchor[]) private_history;

    event Anchored(
        address indexed builder,
        uint256 indexed index,
        bytes32 commitHash,
        uint64 timestamp,
        string label
    );

    error EmptyLabel();
    error LabelTooLong();

    uint256 public constant MAX_LABEL_LENGTH = 200;

    /// @notice Record a new anchor for msg.sender. Anyone can anchor for themselves; nobody can anchor for someone else. 
    /// @param commitHash keccak256 hash of the commit SHA or content being proven 
    /// @param label short description of what this anchor represents 
    function anchor(bytes32 commitHash, string calldata label) external {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (bytes(label).length > MAX_LABEL_LENGTH) revert LabelTooLong();

        _history[msg.sender].push(
            Anchor({commitHash: commitHash, timestamp: uint64(block.timestamp), label: label})
        );

        emit Anchored(msg.sender, _history[msg.sender].length -1, commitHash, uint64(block.timestamp), label );
    }

    /// @notice Full anchor history for a builder 
    function getHistory(address builder) external view returns (Anchor[] memory) {
        return _history[builder];
    }

    /// @notice Number of anchors a builder has recorded.
    function count(address builder) external view returns (uint256) {
        return _history[builder].length;
    }

    /// @notice Timestamp of a builder's very first anchor (0 if none exist)
    /// @dev Useful for judges/judging agents checking whether work started before an event's officail start time
    function firstAnchorTimestamp(address builder) external view returns (uint64) {
        if (_history[builder].length == 0) return 0;
        return _history[builder][0].timestamp;
    } 
}