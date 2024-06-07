export const ROLE_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "event RoleGranted(bytes32 indexed role, address indexed grantee)",
  "event RoleRevoked(bytes32 indexed role, address indexed revokee)",
];
