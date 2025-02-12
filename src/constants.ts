import { ChainSlug } from "@socket.tech/dl-core";
import { Project, Tokens } from "./enums";

export const ChainSlugToProject: { [chainSlug in ChainSlug]?: Project } = {
  [ChainSlug.AEVO]: Project.AEVO,
  [ChainSlug.AEVO_TESTNET]: Project.AEVO_TESTNET,
  [ChainSlug.LYRA_TESTNET]: Project.LYRA_TESTNET,
  [ChainSlug.LYRA]: Project.LYRA,
  [ChainSlug.SX_NETWORK_TESTNET]: Project.SX_NETWORK_TESTNET,
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const BRIDGER_L2_ADDRESS = "0x26181Dfc530d96523350e895180b09BAf3d816a0";
