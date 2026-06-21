const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')
require('dotenv').config()

if (process.argv.length < 3) {
  console.error('Usage: node configureEnv.cjs <stage|prod|dev>')
  process.exit(1)
}
const env = process.argv[2]
if (!(env === 'stage' || env === 'prod' || env === 'dev')) {
  console.error("Invalid environment arg. Please use 'stage', 'prod', or 'dev'.")
  process.exit(1)
}

const CONFIGURED_ENV_FILE = `.env.${env}.local`
if (env === 'stage' || env === 'prod') {
  try {
    const ENV_FILE = `.env.${env}`

    const parsedEnv = dotenv.config({ path: path.join(__dirname, '..', ENV_FILE) })

    if (parsedEnv.error) {
      throw parsedEnv.error
    }

    let envString = Object.entries(parsedEnv.parsed)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const VITE_DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || './'
    envString += `\nVITE_DASHBOARD_BASE_URL=${VITE_DASHBOARD_BASE_URL}`
    console.log(`Protocol dashboard base path: ${VITE_DASHBOARD_BASE_URL}`)

    const configuredEnv = path.join(__dirname, '..', CONFIGURED_ENV_FILE)
    fs.writeFile(configuredEnv, envString, err => {
      if (err) {
        console.error(err)
      }
      console.log(`Successfully configured ${CONFIGURED_ENV_FILE}`)
    })
  } catch (e) {
    console.error(`Could not configure ${env} env:`, e)
  }
} else if (env === 'dev') {
  // Dev mode resolves eth values from the developer's local Audius config
  // (~/.audius/eth-config.json). The Solana/IPFS/identity values that the
  // legacy AudiusLibs initialization consumed have been removed — they are
  // no longer read by any application code after the @audius/sdk-legacy
  // removal. See ./src/services/Audius/setup.ts.
  const AUDIUS_ETH_CONFIG = '.audius/eth-config.json'

  const homeDir = require('os').homedir()
  try {
    const ethConfigFile = require(path.join(homeDir, AUDIUS_ETH_CONFIG))
    console.log(ethConfigFile)

    const remoteHost = process.env.AUDIUS_REMOTE_DEV_HOST
    const localhost = '0.0.0.0'
    const useRemoteHost =
      remoteHost && process.argv.length > 3 && process.argv[3] === 'remote'
    const host = useRemoteHost ? remoteHost : localhost

    const VITE_DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || './'
    const VITE_ENVIRONMENT = 'development'

    const VITE_ETH_PROVIDER_URL = `http://${host}:8546`
    // Chain id is 1337 for local eth ganache because we are ... leet
    const VITE_ETH_NETWORK_ID = 1337

    const VITE_AUDIUS_URL = `http://${host}:3000`
    const VITE_GQL_URI = `http://${host}:8000/subgraphs/name/AudiusProject/audius-subgraph`

    const contents = `
    # DO NOT MODIFY. SEE /scripts/configureEnv.cjs

    VITE_DASHBOARD_BASE_URL=${VITE_DASHBOARD_BASE_URL}
    VITE_ENVIRONMENT=${VITE_ENVIRONMENT}

    VITE_ETH_PROVIDER_URL=${VITE_ETH_PROVIDER_URL}
    VITE_ETH_NETWORK_ID=${VITE_ETH_NETWORK_ID}

    VITE_AUDIUS_URL=${VITE_AUDIUS_URL}
    VITE_GQL_URI=${VITE_GQL_URI}
    `

    // Note .env.development.local takes precidence over .env.development
    // https://facebook.github.io/create-react-app/docs/adding-custom-environment-variables
    fs.writeFile(CONFIGURED_ENV_FILE, contents, err => {
      if (err) {
        console.error(err)
      }
      console.log(`Successfully configured ${CONFIGURED_ENV_FILE}`)
    })
  } catch (e) {
    console.error(`
      Did not find configuration file.
      See https://github.com/AudiusProject/audius-e2e-tests to configure a local dev environment.
    `, e)
  }
}
