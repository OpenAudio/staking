import { developmentConfig, productionConfig, sdk } from '@audius/sdk'

const env = import.meta.env.VITE_ENVIRONMENT

const sdkConfig = env === 'development' ? developmentConfig : productionConfig
const apiEndpoint =
  import.meta.env.VITE_DISCOVERY_PROVIDER ?? sdkConfig.network.apiEndpoint

const audiusSdk = sdk({
  appName: 'Open Audio Protocol Staking',
  environment: env
})

export { audiusSdk, apiEndpoint }
