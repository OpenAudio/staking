export type BadgeTier = 'none' | 'bronze' | 'silver' | 'gold' | 'platinum'

export type BadgeTierInfo = {
  tier: BadgeTier
  humanReadableAmount: number
}

export const badgeTiers: BadgeTierInfo[] = [
  {
    tier: 'platinum',
    humanReadableAmount: 10000
  },
  {
    tier: 'gold',
    humanReadableAmount: 1000
  },
  {
    tier: 'silver',
    humanReadableAmount: 100
  },
  {
    tier: 'bronze',
    humanReadableAmount: 10
  },
  {
    tier: 'none',
    humanReadableAmount: 0
  }
]

