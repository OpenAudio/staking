import { developmentConfig, productionConfig, sdk } from '@audius/sdk'

const env = import.meta.env.VITE_ENVIRONMENT

const sdkConfig = env === 'development' ? developmentConfig : productionConfig
const apiEndpoint = sdkConfig.network.apiEndpoint

const audiusSdk = sdk({
  appName: 'Open Audio Protocol Staking',
  environment: env
})

export { audiusSdk, apiEndpoint }
