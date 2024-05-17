import {
  ChainSlug,
  DeploymentMode,
  IntegrationTypes,
} from "@socket.tech/dl-core";
import { Hooks, ProjectConstants } from "../../../../src";
import { Tokens } from "../../../../src/enums";

export const pc: ProjectConstants = {
  [DeploymentMode.PROD]: {
    [Tokens.DAI]: {
      vaultChains: [ChainSlug.ARBITRUM_SEPOLIA],
      controllerChains: [ChainSlug.KINTO_DEVNET],
      hook: {
        hookType: Hooks.KINTO_HOOK,
        limitsAndPoolId: {
          [ChainSlug.KINTO_DEVNET]: {
            [IntegrationTypes.fast]: {
              sendingLimit: "1000000",
              receivingLimit: "1000000",
            },
          },
          [ChainSlug.ARBITRUM_SEPOLIA]: {
            [IntegrationTypes.fast]: {
              sendingLimit: "1000000",
              receivingLimit: "1000000",
            },
          },
        },
      },
    },
    [Tokens.USDe]: {
      vaultChains: [ChainSlug.ARBITRUM_SEPOLIA],
      controllerChains: [ChainSlug.KINTO_DEVNET],
      hook: {
        hookType: Hooks.KINTO_HOOK,
        limitsAndPoolId: {
          [ChainSlug.KINTO_DEVNET]: {
            [IntegrationTypes.fast]: {
              sendingLimit: "1000000",
              receivingLimit: "1000000",
            },
          },
          [ChainSlug.ARBITRUM_SEPOLIA]: {
            [IntegrationTypes.fast]: {
              sendingLimit: "1000000",
              receivingLimit: "1000000",
            },
          },
        },
      },
    },
  },
};
