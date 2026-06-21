import { useState, useCallback, useEffect } from 'react'

import { AnyAction } from '@reduxjs/toolkit'
import { useDispatch } from 'react-redux'
import { Action } from 'redux'
import { ThunkAction, ThunkDispatch } from 'redux-thunk'

import Audius from 'services/Audius'
import { getAccountWallet } from 'store/account/hooks'
import { getContentNode } from 'store/cache/contentNode/hooks'
import { getDiscoveryProvider } from 'store/cache/discoveryProvider/hooks'
import { fetchUser } from 'store/cache/user/hooks'
import { getValidator } from 'store/cache/validator/hooks'
import { AppState } from 'store/types'
import { Status, ServiceType, BigNumber, Address } from 'types'

function registerAudiusService(
  serviceType: ServiceType,
  endpoint: string,
  stakingAmount: BigNumber,
  delegateOwnerWallet: string | undefined,
  setStatus: (status: Status) => void,
  setError: (msg: string) => void
): ThunkAction<void, AppState, Audius, Action<string>> {
  return async (dispatch, getState, aud) => {
    setStatus(Status.Loading)

    const state = getState()
    const wallet = getAccountWallet(state)

    try {
      let spID
      // Register the service on chain (eth)
      if (delegateOwnerWallet) {
        const res = await aud.ServiceProviderClient.registerWithDelegate(
          serviceType,
          endpoint,
          stakingAmount,
          delegateOwnerWallet
        )
        spID = res.spID
      } else {
        const res = await aud.ServiceProviderClient.register(
          serviceType,
          endpoint,
          stakingAmount
        )
        spID = res.spID
      }

      // Note: the legacy AudiusLibs SDK also did a Solana-side
      // `createSenderPublic` call here to register this node as a sender
      // in the Solana RewardsManager. That step was wrapped in try/catch
      // and explicitly tolerated failure — the comment was "someone else
      // could register this node as a sender since this mechanism is
      // permissionless". As part of removing @audius/sdk-legacy we drop
      // the call rather than port the Solana program client; the eth-side
      // registration above is what makes the node visible on-chain.

      // Repull pending transactions
      if (wallet) await dispatch(fetchUser(wallet))
      if (serviceType === ServiceType.DiscoveryProvider) {
        await dispatch(getDiscoveryProvider(spID))
      } else if (serviceType === ServiceType.ContentNode) {
        await dispatch(getContentNode(spID))
      } else {
        await dispatch(getValidator(spID))
      }

      setStatus(Status.Success)
    } catch (err) {
      setStatus(Status.Failure)
      setError(err.message)
    }
  }
}

export const useRegisterService = (shouldReset?: boolean) => {
  const [status, setStatus] = useState<undefined | Status>()
  const [error, setError] = useState<string>('')
  const dispatch: ThunkDispatch<AppState, Audius, AnyAction> = useDispatch()
  useEffect(() => {
    if (shouldReset) {
      setStatus(undefined)
      setError('')
    }
  }, [shouldReset, setStatus, setError])

  const registerService = useCallback(
    (
      serviceType: ServiceType,
      endpoint: string,
      stakingAmount: BigNumber,
      delegateOwnerWallet: Address
    ) => {
      if (status !== Status.Loading) {
        dispatch(
          registerAudiusService(
            serviceType,
            endpoint,
            stakingAmount,
            delegateOwnerWallet,
            setStatus,
            setError
          )
        )
      }
    },
    [dispatch, status, setStatus, setError]
  )
  return { status, error, registerService }
}
