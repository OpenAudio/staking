// Stub hooks for analytics - components still reference these but Analytics page is removed
import { Bucket, MetricError } from './slice'

export const useApiCalls = () => {
  return { data: null, loading: false, error: null, apiCalls: null }
}

export const useTrailingApiCalls = () => {
  return { data: null, loading: false, error: null, apiCalls: null }
}

export const useTotalStaked = () => {
  return { data: null, loading: false, error: null, totalStaked: null }
}

export const usePlays = () => {
  return { data: null, loading: false, error: null, plays: null }
}

export const useTopApps = () => {
  return { data: null, loading: false, error: null, topApps: null }
}

export const useTrailingTopGenres = () => {
  return { data: null, loading: false, error: null, genres: null }
}

export const useIndividualNodeUptime = () => {
  return { data: null, loading: false, error: null, uptime: null }
}

export const useIndividualServiceApiCalls = () => {
  return { data: null, loading: false, error: null, apiCalls: null }
}

// formatBucketText has been moved to utils/format.ts
// Re-export for backward compatibility
export { formatBucketText } from 'utils/format'

