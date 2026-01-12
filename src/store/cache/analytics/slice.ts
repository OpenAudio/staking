// Stub slice for analytics - components still reference these but Analytics page is removed
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export enum Bucket {
  ALL_TIME = 'all_time', // Granularity: year
  YEAR = 'year', // Granularity: month
  MONTH = 'month', // Granularity: week
  WEEK = 'week', // Granularity: day
  DAY = 'day' // Granularity: hour
}

export enum MetricError {
  ERROR = 'error'
}

export type AnalyticsState = {
  // Empty state since Analytics page is removed
}

const initialState: AnalyticsState = {}

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {}
})

export default analyticsSlice.reducer

